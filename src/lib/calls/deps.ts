// What the calls job needs from the outside world, so tests can script every answer: the database (the
// job's own client, src/lib/calls/db.ts), fetch for Callyzer, the recordings and Deepgram, a clock, the
// routine starter and a logger. src/lib/calls/server.ts builds the real one. Also the job's bookkeeping
// (sync_state['callyzer'].value) and the state one run's poll, workers and housekeeping share.

import type { EventLevel } from "@/lib/ingest/intake";
import type { RoutineStart } from "@/lib/routine";
import type { Db } from "@/lib/supabase/server";
import { END_RESERVE_MS, ITEM_BUDGET_MS, RUN_DEADLINE_MS } from "./budget";
import type { CallsSettings } from "./settings";
import type { TodayStats } from "./types";

export interface CallsDeps {
  db: Db;
  fetch: typeof fetch;
  now(): Date;
  sleep(ms: number): Promise<void>;
  env: { callyzerBase?: string; callyzerKey?: string; deepgramKey?: string; supabaseUrl?: string };
  /** src/lib/routine.ts startRoutine, unchanged; never throws. */
  startRoutine(reason: string): Promise<RoutineStart>;
  /** pipeline_events (warnings and errors also on the console); every message is sanitised first. */
  log(level: EventLevel, step: string, message: string, meetingId?: string | null): Promise<void>;
  /** Removes objects from the private recordings bucket in one request. Never throws. */
  removeObjects(paths: string[]): Promise<{ ok: boolean; error?: string }>;
}

export type SttStop = "auth" | "credit" | "cap";
export type OffReason = "not_configured" | "paused";

/**
 * sync_state['callyzer'].value: written once per run, in the job's finally, under the lock. Holds no
 * number, name or link: error kinds, times, counts and, for a copy error, only the media host's name.
 */
export interface CallyzerState {
  lastRunAt: string | null;
  lastPollOkAt: string | null;
  /** The last read of today-2..today (every 10 minutes, for links that arrive late). */
  lastWideReadAt: string | null;
  pollHoldUntil: string | null;
  pollError: string | null;
  pollErrorAt: string | null;
  /** Polls in a row that failed with pollError; one alert at 3, deduplicated by pollAlerted until a poll succeeds. */
  pollFailures: number;
  pollAlerted: boolean;
  /** The IST day the poll last warned about rows it could not read (once a day, not every run). */
  badRowsWarnedOn: string | null;
  sttError: SttStop | null;
  sttErrorAt: string | null;
  copyError: { kind: string; host?: string; at: string } | null;
  copyFailuresInARow: number;
  copyAlerted: boolean;
  off: OffReason | null;
  /** The last poll's counts of today's calls (IST) on lines that are on; `lines` repeats today.lines. */
  today: TodayStats | null;
  lines: TodayStats["lines"] | null;
  lastTranscribedAt: string | null;
  /** The calls job's own routine starts; never cleared, so a failed start cannot repeat every 2 minutes. */
  routineAttemptAt: string | null;
  routineFailureAt: string | null;
}

const EMPTY_STATE: CallyzerState = {
  lastRunAt: null,
  lastPollOkAt: null,
  lastWideReadAt: null,
  pollHoldUntil: null,
  pollError: null,
  pollErrorAt: null,
  pollFailures: 0,
  pollAlerted: false,
  badRowsWarnedOn: null,
  sttError: null,
  sttErrorAt: null,
  copyError: null,
  copyFailuresInARow: 0,
  copyAlerted: false,
  off: null,
  today: null,
  lines: null,
  lastTranscribedAt: null,
  routineAttemptAt: null,
  routineFailureAt: null,
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null => (values.includes(v as T) ? (v as T) : null);

/** The stored value, read defensively: anything missing or malformed takes its empty default. */
export function parseCallyzerState(json: unknown): CallyzerState {
  if (!isObject(json)) return { ...EMPTY_STATE };
  const copy = isObject(json.copyError) && str(json.copyError.kind) ? json.copyError : null;
  const today = isObject(json.today) && str(json.today.day) ? (json.today as unknown as TodayStats) : null;
  return {
    lastRunAt: str(json.lastRunAt),
    lastPollOkAt: str(json.lastPollOkAt),
    lastWideReadAt: str(json.lastWideReadAt),
    pollHoldUntil: str(json.pollHoldUntil),
    pollError: str(json.pollError),
    pollErrorAt: str(json.pollErrorAt),
    pollFailures: int(json.pollFailures),
    pollAlerted: json.pollAlerted === true,
    badRowsWarnedOn: str(json.badRowsWarnedOn),
    sttError: oneOf(json.sttError, ["auth", "credit", "cap"] as const),
    sttErrorAt: str(json.sttErrorAt),
    copyError: copy ? { kind: String(copy.kind), ...(str(copy.host) ? { host: String(copy.host) } : {}), at: str(copy.at) ?? "" } : null,
    copyFailuresInARow: int(json.copyFailuresInARow),
    copyAlerted: json.copyAlerted === true,
    off: oneOf(json.off, ["not_configured", "paused"] as const),
    today,
    lines: isObject(json.lines) ? (json.lines as TodayStats["lines"]) : null,
    lastTranscribedAt: str(json.lastTranscribedAt),
    routineAttemptAt: str(json.routineAttemptAt),
    routineFailureAt: str(json.routineFailureAt),
  };
}

/** What one run did, as counts only (the cron's response and the run's log line). */
export interface CallsCounts {
  callyzerRequests: number;
  rowsFetched: number;
  badRows: number;
  candidates: number;
  /** Ledger rows inserted or changed by upsert_call_log. */
  ledgerWritten: number;
  linesCreated: number;
  copied: number;
  emptyRecordings: number;
  copyFailures: number;
  /** Copies whose line was switched off meanwhile (the object is removed again). */
  dropped: number;
  transcribed: number;
  noSpeech: number;
  transcriptionFailures: number;
  claimsReleased: number;
  linksExpired: number;
  undecidedDeleted: number;
  objectsRemoved: number;
  objectRemovalsFailed: number;
  errors: number;
}

export const zeroCounts = (): CallsCounts => ({
  callyzerRequests: 0,
  rowsFetched: 0,
  badRows: 0,
  candidates: 0,
  ledgerWritten: 0,
  linesCreated: 0,
  copied: 0,
  emptyRecordings: 0,
  copyFailures: 0,
  dropped: 0,
  transcribed: 0,
  noSpeech: 0,
  transcriptionFailures: 0,
  claimsReleased: 0,
  linksExpired: 0,
  undecidedDeleted: 0,
  objectsRemoved: 0,
  objectRemovalsFailed: 0,
  errors: 0,
});

export interface RunState {
  readonly startedAt: Date;
  readonly deadlineMs: number;
  /** Workers claim new items only until this point into the run (52 s for the 270 s deadline). */
  readonly claimCutoffMs: number;
  readonly settings: CallsSettings;
  /** sync_state['callyzer'].value as this run found it. */
  readonly prev: Readonly<CallyzerState>;
  /** The same value as this run changes it; the job writes it back in its finally. */
  readonly state: CallyzerState;
  elapsedMs(): number;
  /** Transcription stopped for the rest of this run: Deepgram refused the key or the credit, or today's cap. */
  sttStopped: SttStop | null;
  /** The poll read today's window and stored it: only then is last_synced_at written. */
  pollOk: boolean;
  turnedReady: number;
  /** Called by a worker when the run's first call turns ready; the job starts its routine decision. */
  onFirstReady(): void;
  counts: CallsCounts;
}

/** `startedAt` is when the job started (before its settings read and lock); the deadline counts from it. */
export function newRunState(
  deps: Pick<CallsDeps, "now">,
  settings: CallsSettings,
  prev: CallyzerState,
  deadlineMs: number = RUN_DEADLINE_MS,
  startedAt: Date = deps.now(),
): RunState {
  return {
    startedAt,
    deadlineMs,
    // CLAIM_CUTOFF_MS (52 s) for the standard 270 s deadline.
    claimCutoffMs: deadlineMs - END_RESERVE_MS - ITEM_BUDGET_MS,
    settings,
    prev: { ...prev },
    state: { ...prev },
    elapsedMs: () => deps.now().getTime() - startedAt.getTime(),
    sttStopped: null,
    pollOk: false,
    turnedReady: 0,
    onFirstReady: () => undefined,
    counts: zeroCounts(),
  };
}

/** Waits at most `ms` for a promise (which keeps running); null when it did not settle in time. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}
