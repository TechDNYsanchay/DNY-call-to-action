// The calls job's time budget. The route's maxDuration is 300 s; every step has its own timeout, and a
// worker only claims new work while the last item it could take still finishes inside the deadline. The
// run's clock starts when the job does, so the settings read and the lock count too.

/** The job stops by this point (route maxDuration 300 s; the rest covers a cold start and the response). */
export const RUN_DEADLINE_MS = 270_000;
/** Kept for the end: the leftover routine check, a bounded routine start, bookkeeping and the unlock. */
export const END_RESERVE_MS = 30_000;
/**
 * One item at worst: claim 6 + download 20 + upload 20 + promote 6 + sign 6 + Deepgram 110 + save 6, and
 * after a failed Deepgram call or save, two more 6 s steps: recording the failure, then its log line or a
 * second try at recording it (+2 slack). Removing a no-speech or dropped recording at once is not in it:
 * the worker skips that when it would run into the end reserve, and the next run's drain removes it.
 */
export const ITEM_BUDGET_MS = 188_000;
/** Workers claim new items only until this point into the run (52 s). */
export const CLAIM_CUTOFF_MS = RUN_DEADLINE_MS - END_RESERVE_MS - ITEM_BUDGET_MS;

export const TIMEOUT_MS = {
  db: 6_000,
  storageWrite: 20_000,
  callyzer: 20_000,
  download: 20_000,
  deepgram: 110_000,
  routineStart: 12_000,
} as const;

/** No Callyzer request starts later than this into the run. */
export const POLL_LAST_REQUEST_MS = 90_000;
/** The longest the poll sleeps through a Sales QA quiet window before giving up for this run. */
export const QUIET_MAX_WAIT_MS = 35_000;
/** Claim release, expiries and the storage drain together, in parallel with the poll and the workers. */
export const HOUSEKEEPING_BUDGET_MS = 20_000;

/** A fetch (or its body) that ran out of the time its AbortSignal.timeout gave it. */
export const isTimeoutError = (error: unknown): boolean => error instanceof Error && error.name === "TimeoutError";
