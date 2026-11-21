// The calls job, every 2 minutes (/api/cron/calls): one poll of Callyzer, two media workers that copy and
// transcribe, and housekeeping, all side by side; then, if no first ready call already did it, one check
// whether to start the routine; then the bookkeeping. Before the lock, the off switches: a database that
// is not this app's (nothing runs at all), missing keys or calls paused (only the privacy housekeeping
// runs: undecided calls past their time are deleted and the deletion queue is drained).

import { acquireLock, releaseLock } from "@/lib/ingest/lock";
import type { Json } from "@/lib/supabase/database.types";
import type { Db } from "@/lib/supabase/server";
import { RUN_DEADLINE_MS, TIMEOUT_MS } from "./budget";
import { type CallsCounts, type CallsDeps, newRunState, type OffReason, parseCallyzerState, type RunState, withTimeout, zeroCounts } from "./deps";
import { pollAndIngest, type PollResult } from "./poll";
import { routineStartDecision } from "./routine-policy";
import { errorText, pgErrorText } from "./sanitize";
import { type CallsSettings, parseCallsSettings } from "./settings";
import { housekeeping, runWorker } from "./worker";

export const CALLS_LOCK_KEY = "callyzer";
/** As long as the route may run (maxDuration 300 s), so a killed run blocks the next two runs and no more. */
export const CALLS_LOCK_MS = 300_000;
/** NEXT_PUBLIC_SUPABASE_URL must name this app's project or the local stack; anything else and nothing runs. */
export const TRIPWIRE_HOSTS = ["iaxjxefipmdumfukttvv.supabase.co", "127.0.0.1", "localhost"] as const;

/** Counts only: the cron's response never carries a number, a name or a link. */
export interface CallsRunResult extends CallsCounts {
  off?: OffReason | "tripwire";
  skipped?: "locked";
  /** "ok", why the poll did not read today (hold, night, quiet, budget), or "error: <kind>". */
  poll?: string;
  /** The routine decision: started, recent, off, failed, timeout, "not started: <reason>", or error. */
  routine?: string;
}

function tripwireOk(supabaseUrl: string | undefined): boolean {
  try {
    return (TRIPWIRE_HOSTS as readonly string[]).includes(new URL(supabaseUrl ?? "").hostname);
  } catch {
    return false;
  }
}

/** The names of the keys the job needs that are not set (never their values). */
function missingKeys(env: CallsDeps["env"]): string[] {
  const keys: Array<[string, string | undefined]> = [
    ["CALLYZER_API_BASE", env.callyzerBase],
    ["CALLYZER_API_KEY", env.callyzerKey],
    ["DEEPGRAM_API_KEY", env.deepgramKey],
  ];
  return keys.filter(([, value]) => !value?.trim()).map(([name]) => name);
}

async function readCallsSettings(db: Db): Promise<CallsSettings> {
  const { data, error } = await db.from("settings").select("key, value");
  if (error) throw new Error(`settings read failed: ${pgErrorText(error)}`);
  return parseCallsSettings(data ?? []);
}

const dateOrNull = (iso: string | null | undefined): Date | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t) : null;
};

/**
 * Whether to start the routine now (src/lib/calls/routine-policy.ts), from live state: the calls in
 * 'ready' and the newest claim still processing. Every attempt is recorded, a failed one too, so the
 * policy's backoff holds across runs. Never throws; returns what happened in words.
 */
async function startRoutineIfNeeded(deps: CallsDeps, run: RunState): Promise<string> {
  try {
    const now = deps.now();
    const [ready, processing] = await Promise.all([
      deps.db.from("meetings").select("id, phone_calls(ready_at)").eq("kind", "call").eq("process_status", "ready").limit(500),
      deps.db.from("meetings").select("claimed_at").eq("process_status", "processing").not("claimed_at", "is", null).order("claimed_at", { ascending: false }).limit(1),
    ]);
    const readError = ready.error ?? processing.error;
    if (readError) throw new Error(pgErrorText(readError));
    const readyCalls = ready.data ?? [];
    const readyAts = readyCalls.map((m) => Date.parse(m.phone_calls?.ready_at ?? "")).filter(Number.isFinite);
    const decision = routineStartDecision({
      now,
      pipelinePaused: run.settings.pipelinePaused,
      readyCalls: readyCalls.length,
      oldestReadyCallAt: readyAts.length ? new Date(Math.min(...readyAts)) : null,
      newestProcessingClaimAt: dateOrNull(processing.data?.[0]?.claimed_at),
      lastAttemptAt: dateOrNull(run.prev.routineAttemptAt),
      lastFailureAt: dateOrNull(run.prev.routineFailureAt),
    });
    if (!decision.start) return `not started: ${decision.reason}`;
    run.state.routineAttemptAt = now.toISOString();
    const n = readyCalls.length;
    const started = await withTimeout(deps.startRoutine(`${n} call${n === 1 ? "" : "s"} ready (${decision.reason})`), TIMEOUT_MS.routineStart);
    if (started === null || started === "failed") run.state.routineFailureAt = deps.now().toISOString();
    return started ?? "timeout";
  } catch (error) {
    run.counts.errors++;
    await deps.log("warn", "calls", `Checking whether to start the routine failed: ${errorText(error)}`);
    return "error";
  }
}

const SUMMARY: Array<[keyof CallsCounts, string, string]> = [
  ["linesCreated", "new phone line", "new phone lines"],
  ["ledgerWritten", "call recorded or updated in the ledger", "calls recorded or updated in the ledger"],
  ["copied", "recording copied", "recordings copied"],
  ["emptyRecordings", "empty recording", "empty recordings"],
  ["copyFailures", "copy failed", "copies failed"],
  ["dropped", "copy dropped (line switched off)", "copies dropped (line switched off)"],
  ["transcribed", "call transcribed", "calls transcribed"],
  ["noSpeech", "call with no speech deleted", "calls with no speech deleted"],
  ["transcriptionFailures", "transcription failed", "transcriptions failed"],
  ["claimsReleased", "routine claim timed out", "routine claims timed out"],
  ["linksExpired", "call never got a recording", "calls never got a recording"],
  ["undecidedDeleted", "undecided call deleted", "undecided calls deleted"],
  ["objectsRemoved", "stored recording removed", "stored recordings removed"],
  ["objectRemovalsFailed", "recording removal failed", "recording removals failed"],
  ["errors", "error", "errors"],
];

/** One line per run in pipeline_events, only when the run did something. */
async function logSummary(deps: CallsDeps, run: RunState): Promise<void> {
  const parts = SUMMARY.filter(([key]) => run.counts[key] > 0).map(([key, one, many]) => `${run.counts[key]} ${run.counts[key] === 1 ? one : many}`);
  if (parts.length) await deps.log(run.counts.errors ? "warn" : "info", "calls", `Calls run: ${parts.join(", ")}`);
}

const pollText = (p: PollResult | null): string => (!p ? "error" : p.ok ? "ok" : p.skipped ?? `error: ${p.error ?? "unknown"}`);

/** sync_state['callyzer']: the run's value, last_synced_at only after a good poll, and the lock freed. */
async function writeBookkeeping(deps: CallsDeps, run: RunState): Promise<void> {
  run.state.lastRunAt = run.startedAt.toISOString();
  run.state.off = null;
  try {
    const { error } = await deps.db
      .from("sync_state")
      .update({ value: run.state as unknown as Json, locked_until: null, ...(run.pollOk ? { last_synced_at: run.state.lastPollOkAt } : {}) })
      .eq("key", CALLS_LOCK_KEY);
    if (!error) return;
    console.error(`calls job: bookkeeping failed: ${pgErrorText(error)}`);
  } catch (error) {
    console.error(`calls job: bookkeeping failed: ${errorText(error)}`);
  }
  await releaseLock(deps.db, CALLS_LOCK_KEY).catch((error: unknown) => console.error(`calls job: ${errorText(error)}`));
}

/** Calls paused or not configured: privacy housekeeping only, and the switch recorded for the status line. */
async function offRun(deps: CallsDeps, settings: CallsSettings, off: OffReason, missing: string[], deadlineMs: number): Promise<CallsRunResult> {
  const { data: row, error } = await deps.db.from("sync_state").select("value").eq("key", CALLS_LOCK_KEY).maybeSingle();
  if (error) throw new Error(`sync_state read failed: ${pgErrorText(error)}`);
  const prev = parseCallyzerState(row?.value);
  // Only the missing names, once when it starts.
  if (off === "not_configured" && prev.off !== "not_configured") {
    await deps.log("warn", "calls", `Phone calls are not configured: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`);
  }
  const run = newRunState(deps, settings, prev, deadlineMs);
  await housekeeping(deps, run, { privacyOnly: true });
  await logSummary(deps, run);
  // Written only while no run holds the lock: a run still finishing keeps its own bookkeeping.
  const { error: writeError } = await deps.db
    .from("sync_state")
    .update({ value: { ...prev, off, lastRunAt: run.startedAt.toISOString() } as unknown as Json })
    .eq("key", CALLS_LOCK_KEY)
    .or(`locked_until.is.null,locked_until.lt.${deps.now().toISOString()}`);
  if (writeError) {
    run.counts.errors++;
    console.error(`calls job: recording the off switch failed: ${pgErrorText(writeError)}`);
  }
  return { ...run.counts, off };
}

export async function runCallsJob(deps: CallsDeps, opts: { deadlineMs?: number } = {}): Promise<CallsRunResult> {
  // The run's clock starts here, so the settings read and the lock count against the claim cutoff too.
  const startedAt = deps.now();
  if (!tripwireOk(deps.env.supabaseUrl)) {
    // Not even a log line: the database may be someone else's.
    console.error("calls job: NEXT_PUBLIC_SUPABASE_URL is not this app's database; nothing ran");
    return { ...zeroCounts(), off: "tripwire" };
  }
  const deadlineMs = opts.deadlineMs ?? RUN_DEADLINE_MS;
  const settings = await readCallsSettings(deps.db);
  const missing = missingKeys(deps.env);
  if (missing.length) return offRun(deps, settings, "not_configured", missing, deadlineMs);
  if (settings.paused) return offRun(deps, settings, "paused", [], deadlineMs);

  const lock = await acquireLock(deps.db, CALLS_LOCK_KEY, CALLS_LOCK_MS, deps.now());
  if (!lock) return { ...zeroCounts(), skipped: "locked" };
  const run = newRunState(deps, settings, parseCallyzerState(lock.value), deadlineMs, startedAt);
  let routine: Promise<string> | null = null;
  // The first call of the run that turns ready starts the decision; the worker does not wait for it.
  run.onFirstReady = () => {
    routine ??= startRoutineIfNeeded(deps, run);
  };
  try {
    const poll = pollAndIngest(deps, run);
    const parts = await Promise.allSettled([housekeeping(deps, run), poll, runWorker(deps, run, poll), runWorker(deps, run, poll)]);
    const names = ["housekeeping", "poll", "first worker", "second worker"];
    for (const [i, part] of parts.entries()) {
      if (part.status === "fulfilled") continue;
      run.counts.errors++;
      await deps.log("error", "calls", `The calls ${names[i]} stopped: ${errorText(part.reason)}`);
    }
    const polled = parts[1].status === "fulfilled" ? (parts[1].value as PollResult) : null;
    // At the end only when no call turned ready in this run (calls released by the housekeeping count too).
    const routineResult = await (routine ?? startRoutineIfNeeded(deps, run));
    return { ...run.counts, poll: pollText(polled), routine: routineResult };
  } finally {
    // Side by side, so the end of the run stays inside its 30 s reserve.
    await Promise.all([logSummary(deps, run), writeBookkeeping(deps, run)]);
  }
}
