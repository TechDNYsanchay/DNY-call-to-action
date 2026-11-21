// Whether the calls job should start the routine now. Pure. The decision reads live state (calls waiting
// in 'ready', the newest claim still processing) and the job's own record of its attempts, never the
// routine's notes. startRoutine (src/lib/routine.ts) is then called unchanged; it never throws.

/** After a failed start, the calls job waits this long before trying again. */
export const FAILED_START_BACKOFF_MS = 10 * 60_000;
/** At most one start every 3 minutes from calls (20 an hour, under the routine's 30 API fires an hour). */
export const MIN_ATTEMPT_GAP_MS = 3 * 60_000;
/** A claim this young means a run is alive and takes ready items next (the call claim timeout). */
export const LIVE_CLAIM_MS = 20 * 60_000;
/** ...unless a call has waited this long: the live run may be on a long meeting or at its item limit. */
export const READY_WAIT_MS = 10 * 60_000;

export interface RoutineStartInput {
  now: Date;
  pipelinePaused: boolean;
  /** Calls in 'ready', and when the oldest of them became ready (phone_calls.ready_at). */
  readyCalls: number;
  oldestReadyCallAt: Date | null;
  /** max(meetings.claimed_at) over rows still 'processing', meetings and calls alike. */
  newestProcessingClaimAt: Date | null;
  /** sync_state['callyzer'].value.routineAttemptAt / routineFailureAt; never cleared. */
  lastAttemptAt: Date | null;
  lastFailureAt: Date | null;
}

const since = (now: Date, at: Date | null) => (at ? now.getTime() - at.getTime() : Number.POSITIVE_INFINITY);

export function routineStartDecision(i: RoutineStartInput): { start: boolean; reason: string } {
  if (i.pipelinePaused) return { start: false, reason: "sheets are paused" };
  if (i.readyCalls <= 0) return { start: false, reason: "no call is ready" };
  if (since(i.now, i.lastFailureAt) < FAILED_START_BACKOFF_MS) return { start: false, reason: "backing off after a failed start" };
  if (since(i.now, i.lastAttemptAt) < MIN_ATTEMPT_GAP_MS) return { start: false, reason: "a start was tried less than 3 minutes ago" };
  if (since(i.now, i.newestProcessingClaimAt) < LIVE_CLAIM_MS) {
    if (since(i.now, i.oldestReadyCallAt) >= READY_WAIT_MS && i.oldestReadyCallAt) {
      return { start: true, reason: "a call has waited 10 minutes while a run is busy" };
    }
    return { start: false, reason: "a run is working and takes ready calls next" };
  }
  return { start: true, reason: "a call is ready and no run is working" };
}
