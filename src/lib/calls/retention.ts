// The calls' share of the nightly retention (GET /api/cron/retention). Every calls run already deletes calls
// that are not work calls at once and drains a few queued objects; the night catches up on the rest, in this
// order: undecided calls past their time (F18), business calls' audio past calls_audio_retention_days (F19),
// ledger rows that never became calls (F20), recordings nothing points at (the orphan sweep), and then the
// deletion queue. Sheets and action items are kept. Nothing here talks to Callyzer.

import { IST } from "@/lib/format";
import type { Db } from "@/lib/supabase/server";
import { drainStorageDeletions, QUEUE_WRITE_CHUNK, RECORDINGS_BUCKET } from "./purge";
import { errorText, pgErrorText } from "./sanitize";
import type { CallsSettings } from "./settings";
import { UNDECIDED_MAX_DAYS } from "./worker";

/** Ledger rows that never became a call are kept this long (they let a late recording still be picked up). */
export const LEDGER_KEEP_DAYS = 14;
/** An object nothing points at is an orphan only once it is this old: a copy in flight is younger. */
export const ORPHAN_MIN_AGE_MS = 86_400_000;
/** Queued objects removed per night, in one request. */
export const NIGHTLY_DRAIN_LIMIT = 500;
/** expire_undecided_calls deletes at most this many per invocation; the night repeats it while it is full. */
const UNDECIDED_BATCH = 50;
const UNDECIDED_MAX_ROUNDS = 20;
const LIST_PAGE = 1000;
const QUEUE_INSERT_CHUNK = 500;

export interface CallsRetention {
  undecidedDeleted: number;
  audioExpired: number;
  ledgerCleaned: number;
  orphansQueued: number;
  objectsRemoved: number;
  objectRemovalsFailed: number;
  /** One sanitised line per step that failed; the other steps still ran. */
  errors: string[];
}

const YEAR_MONTH = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit" });

/** The folders the orphan sweep lists: this month's and last month's, by the IST month in the path. */
export function sweepFolders(now: Date): string[] {
  const parts = Object.fromEntries(YEAR_MONTH.formatToParts(now).map((p) => [p.type, p.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const folder = (y: number, m: number) => `calls/${y}/${String(m).padStart(2, "0")}`;
  return [folder(year, month), month === 1 ? folder(year - 1, 12) : folder(year, month - 1)];
}

/** Stored objects older than a day that nothing references. Pure. */
export function orphanPaths(objects: Array<{ path: string; createdAt: string | null }>, referenced: ReadonlySet<string>, now: Date): string[] {
  return objects
    .filter((o) => {
      const created = o.createdAt ? Date.parse(o.createdAt) : NaN;
      return !referenced.has(o.path) && Number.isFinite(created) && now.getTime() - created > ORPHAN_MIN_AGE_MS;
    })
    .map((o) => o.path);
}

async function listRecordings(db: Db, folders: string[]): Promise<Array<{ path: string; createdAt: string | null }>> {
  const out: Array<{ path: string; createdAt: string | null }> = [];
  for (const folder of folders) {
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await db.storage.from(RECORDINGS_BUCKET).list(folder, { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(`listing ${folder} failed: ${errorText(error)}`);
      const page = data ?? [];
      // Folders come back with no id; every recording sits directly in its month's folder.
      for (const entry of page) if (entry.id) out.push({ path: `${folder}/${entry.name}`, createdAt: entry.created_at ?? null });
      if (page.length < LIST_PAGE) break;
    }
  }
  return out;
}

/**
 * Queues ('orphan') every recording of this and last month that is older than a day and is neither a call's
 * recording (phone_calls.recording_path) nor a copy in progress (a pending or running ledger row's
 * storage_path): an upload whose call never came, or a lease a stopped run left behind. Returns how many.
 */
export async function queueOrphans(db: Db, now: Date): Promise<number> {
  const old = orphanPaths(await listRecordings(db, sweepFolders(now)), new Set(), now);
  if (!old.length) return 0;
  const referenced = new Set<string>();
  // .in() puts the paths in the URL: QUEUE_WRITE_CHUNK at a time keeps it under the gateway's limit.
  for (let i = 0; i < old.length; i += QUEUE_WRITE_CHUNK) {
    const chunk = old.slice(i, i + QUEUE_WRITE_CHUNK);
    const [calls, ledger] = await Promise.all([
      db.from("phone_calls").select("recording_path").in("recording_path", chunk),
      db.from("call_log").select("storage_path").in("status", ["pending", "running"]).in("storage_path", chunk),
    ]);
    if (calls.error) throw new Error(`phone_calls read failed: ${pgErrorText(calls.error)}`);
    if (ledger.error) throw new Error(`call_log read failed: ${pgErrorText(ledger.error)}`);
    for (const row of calls.data ?? []) if (row.recording_path) referenced.add(row.recording_path);
    for (const row of ledger.data ?? []) if (row.storage_path) referenced.add(row.storage_path);
  }
  const orphans = old.filter((path) => !referenced.has(path));
  for (let i = 0; i < orphans.length; i += QUEUE_INSERT_CHUNK) {
    const rows = orphans.slice(i, i + QUEUE_INSERT_CHUNK).map((path) => ({ path, reason: "orphan" as const }));
    const { error } = await db.from("storage_deletions").upsert(rows, { onConflict: "path", ignoreDuplicates: true });
    if (error) throw new Error(`storage_deletions insert failed: ${pgErrorText(error)}`);
  }
  return orphans.length;
}

/** Runs every step; a step that fails is reported and the next one still runs. */
export async function runCallsRetention(db: Db, opts: { now: Date; settings: CallsSettings }): Promise<CallsRetention> {
  const s = opts.settings;
  const out: CallsRetention = { undecidedDeleted: 0, audioExpired: 0, ledgerCleaned: 0, orphansQueued: 0, objectsRemoved: 0, objectRemovalsFailed: 0, errors: [] };
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      out.errors.push(`${name}: ${errorText(error)}`);
    }
  };
  await step("undecided calls", async () => {
    for (let round = 0; round < UNDECIDED_MAX_ROUNDS; round++) {
      const { data, error } = await db.rpc("expire_undecided_calls", { p_decision_hours: s.decisionHours, p_failed_days: s.undecidedFailedDays, p_max_days: UNDECIDED_MAX_DAYS });
      if (error) throw new Error(pgErrorText(error));
      out.undecidedDeleted += data ?? 0;
      if ((data ?? 0) < UNDECIDED_BATCH) break;
    }
  });
  await step("recordings past retention", async () => {
    const { data, error } = await db.rpc("expire_call_audio", { p_days: s.audioRetentionDays });
    if (error) throw new Error(pgErrorText(error));
    out.audioExpired = data ?? 0;
  });
  await step("ledger rows", async () => {
    const { data, error } = await db.rpc("cleanup_call_log", { p_days: LEDGER_KEEP_DAYS });
    if (error) throw new Error(pgErrorText(error));
    out.ledgerCleaned = data ?? 0;
  });
  await step("orphaned recordings", async () => {
    out.orphansQueued = await queueOrphans(db, opts.now);
  });
  await step("deletion queue", async () => {
    const drained = await drainStorageDeletions(db, { limit: NIGHTLY_DRAIN_LIMIT });
    out.objectsRemoved = drained.removed;
    out.objectRemovalsFailed = drained.failed;
  });
  return out;
}
