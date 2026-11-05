import "server-only";

// Sync: one meeting (webhook, replay) or the whole recent window (cron tick). Both end in intake.ts.
// The cron is the safety net: webhooks are hints that may never arrive, so every tick lists recent
// meetings again, retries pending transcripts, and frees meetings a routine run left half-done.

import { supabaseAdmin, type Db } from "@/lib/supabase/server";
import { tldv, TldvError } from "@/lib/tldv/client";
import type { TldvMeeting } from "@/lib/tldv/parse";
import { NO_TRANSCRIPT_REASON, transcriptDecision, type MeetingSource, type ProcessStatus } from "./decisions";
import { logEvent, markWaiting, storeTranscript, upsertMeeting } from "./intake";
import { readSettings } from "./settings";

export interface SyncResult {
  /** Null when tl;dv does not know the meeting. */
  meetingId: string | null;
  status: ProcessStatus | "not_found";
  created: boolean;
  transcriptStored: boolean;
  waiting: boolean;
}

/** Fetch one meeting from tl;dv, upsert it, then store its transcript if tl;dv has finished it. */
export async function syncMeeting(tldvMeetingId: string, source: MeetingSource): Promise<SyncResult> {
  const client = tldv();
  const meeting = await client.getMeeting(tldvMeetingId);
  if (!meeting) {
    await logEvent("warn", "sync", `tl;dv does not know meeting ${tldvMeetingId} (${source})`);
    return { meetingId: null, status: "not_found", created: false, transcriptStored: false, waiting: false };
  }
  const { meetingId, created, status, transcriptReady } = await upsertMeeting(meeting, source);
  if (transcriptReady) return { meetingId, status, created, transcriptStored: false, waiting: false };

  const transcript = await client.getTranscript(tldvMeetingId);
  if (transcript) {
    const stored = await storeTranscript(meetingId, transcript.turns, transcript.transcriptId, transcript.sentenceCount);
    return { meetingId, status: stored.status, created, transcriptStored: true, waiting: false };
  }
  const waitingStatus = await markWaiting(meetingId);
  return { meetingId, status: waitingStatus, created, transcriptStored: false, waiting: true };
}

export interface TickCounts {
  listed: number;
  created: number;
  transcriptsStored: number;
  waiting: number;
  gaveUp: number;
  released: number;
  errors: number;
  /** True when another tick still held the lock and this one did nothing. */
  skipped: boolean;
}

const LOCK_KEY = "tldv";
const LOCK_MINUTES = 9;
const OVERLAP_MS = 2 * 3_600_000;
const FIRST_RUN_WINDOW_MS = 48 * 3_600_000;
const TRANSCRIPT_BATCH = 100;

const zero = (): TickCounts => ({ listed: 0, created: 0, transcriptsStored: 0, waiting: 0, gaveUp: 0, released: 0, errors: 0, skipped: false });

/** Take the soft lock; null when another tick holds it. Returns the last sync time for the window. */
async function acquireLock(db: Db, now: Date): Promise<{ last_synced_at: string | null } | null> {
  const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
  const { data, error } = await db
    .from("sync_state")
    .update({ locked_until: lockedUntil })
    .eq("key", LOCK_KEY)
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .select("last_synced_at");
  if (error) throw new Error(`sync_state lock failed: ${error.message}`);
  if (data && data.length > 0) return data[0];
  // Either locked, or the row is missing (a fresh database): create it and proceed.
  const { data: row, error: readError } = await db.from("sync_state").select("key").eq("key", LOCK_KEY).maybeSingle();
  if (readError) throw new Error(`sync_state read failed: ${readError.message}`);
  if (row) return null;
  const { error: insertError } = await db.from("sync_state").insert({ key: LOCK_KEY, locked_until: lockedUntil });
  if (insertError) return null;
  return { last_synced_at: null };
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The cron body (every 10 minutes). Lists recent meetings, upserts them, tries pending transcripts
 * once each, gives up on meetings with no transcript after 48 h, releases stale routine claims, and
 * records the counts. Stops starting new work after `deadlineMs` so the function never times out.
 */
export async function tick({ now = new Date(), deadlineMs = 240_000 }: { now?: Date; deadlineMs?: number } = {}): Promise<TickCounts> {
  const db = supabaseAdmin();
  const counts = zero();
  const lock = await acquireLock(db, now);
  if (!lock) return { ...counts, skipped: true };
  const started = Date.now();
  const outOfTime = () => Date.now() - started > deadlineMs;

  try {
    const settings = await readSettings(db);
    const client = tldv();

    // 1. List recent meetings, overlapping the previous window so a late tl;dv write is never missed.
    const from = lock.last_synced_at ? new Date(Date.parse(lock.last_synced_at) - OVERLAP_MS) : new Date(now.getTime() - FIRST_RUN_WINDOW_MS);
    let listed: TldvMeeting[] = [];
    let listOk = false;
    try {
      listed = await client.listMeetingsSince(from.toISOString(), { to: new Date(now.getTime() + 60_000).toISOString() });
      listOk = true;
    } catch (error) {
      counts.errors++;
      await logEvent("error", "poll", `Listing tl;dv meetings failed: ${describe(error)}`);
    }
    counts.listed = listed.length;
    for (const meeting of listed) {
      if (outOfTime()) break;
      try {
        const result = await upsertMeeting(meeting, "poll");
        if (result.created) counts.created++;
      } catch (error) {
        counts.errors++;
        await logEvent("error", "poll", `Upsert of tl;dv meeting ${meeting.id} failed: ${describe(error)}`);
      }
    }

    // 2. Transcripts still missing, oldest first, at most one attempt each per tick.
    const graceCutoff = new Date(now.getTime() - 10 * 60_000).toISOString();
    const { data: pending, error: pendingError } = await db
      .from("meetings")
      .select("id, tldv_meeting_id, happened_at, duration_sec, transcript_ready, process_status")
      .eq("transcript_ready", false)
      .in("process_status", ["new", "waiting_transcript"])
      .lt("happened_at", graceCutoff)
      .order("happened_at", { ascending: true })
      .limit(TRANSCRIPT_BATCH);
    if (pendingError) {
      counts.errors++;
      await logEvent("error", "transcript", `Reading pending meetings failed: ${pendingError.message}`);
    }
    for (const m of pending ?? []) {
      if (outOfTime()) break;
      const decision = transcriptDecision(m, now);
      if (decision === "give_up") {
        const { error } = await db.from("meetings").update({ process_status: "skipped", failure_reason: NO_TRANSCRIPT_REASON }).eq("id", m.id).in("process_status", ["new", "waiting_transcript"]);
        if (error) counts.errors++;
        else {
          counts.gaveUp++;
          await logEvent("warn", "transcript", NO_TRANSCRIPT_REASON, m.id);
        }
        continue;
      }
      if (decision !== "try") continue;
      try {
        const transcript = await client.getTranscript(m.tldv_meeting_id);
        if (transcript) {
          await storeTranscript(m.id, transcript.turns, transcript.transcriptId, transcript.sentenceCount);
          counts.transcriptsStored++;
        } else {
          await markWaiting(m.id);
          counts.waiting++;
        }
      } catch (error) {
        counts.errors++;
        await logEvent("error", "transcript", `Transcript fetch failed: ${describe(error)}`, m.id);
        // A bad API key fails every call the same way: stop here instead of logging it 100 times.
        if (error instanceof TldvError && error.isConfiguration) break;
      }
    }

    // 3. Meetings a routine run claimed and never finished go back to 'ready' (or 'failed').
    const { data: released, error: releaseError } = await db.rpc("release_stale_claims", {
      p_timeout_minutes: settings.claim_timeout_minutes,
      p_max_attempts: settings.max_attempts,
    });
    if (releaseError) {
      counts.errors++;
      await logEvent("error", "release", `release_stale_claims failed: ${releaseError.message}`);
    } else {
      counts.released = released ?? 0;
    }

    if (listOk) {
      const { error } = await db.from("sync_state").update({ last_synced_at: now.toISOString() }).eq("key", LOCK_KEY);
      if (error) counts.errors++;
    }
    await logEvent(
      counts.errors ? "warn" : "info",
      "cron",
      `Tick: ${counts.listed} listed, ${counts.created} new, ${counts.transcriptsStored} transcripts stored, ${counts.waiting} still waiting, ${counts.gaveUp} given up, ${counts.released} claims released, ${counts.errors} errors`,
    );
    return counts;
  } finally {
    const { error } = await db.from("sync_state").update({ locked_until: null }).eq("key", LOCK_KEY);
    if (error) console.error(`sync_state unlock failed: ${error.message}`);
  }
}
