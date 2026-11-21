import { describe, expect, it } from "vitest";
import { type RoutineStartInput, routineStartDecision } from "./routine-policy";

const now = new Date("2026-11-19T09:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

const input = (over: Partial<RoutineStartInput> = {}): RoutineStartInput => ({
  now,
  pipelinePaused: false,
  readyCalls: 1,
  oldestReadyCallAt: minutesAgo(1),
  newestProcessingClaimAt: null,
  lastAttemptAt: null,
  lastFailureAt: null,
  ...over,
});

describe("routineStartDecision", () => {
  it("starts when a call is ready and no run is working", () => {
    expect(routineStartDecision(input())).toEqual({ start: true, reason: "a call is ready and no run is working" });
  });
  it("never starts while sheets are paused or when no call is ready", () => {
    expect(routineStartDecision(input({ pipelinePaused: true })).start).toBe(false);
    expect(routineStartDecision(input({ readyCalls: 0, oldestReadyCallAt: null })).start).toBe(false);
  });
  it("backs off for 10 minutes after a failed start", () => {
    expect(routineStartDecision(input({ lastFailureAt: minutesAgo(5), lastAttemptAt: minutesAgo(5) }))).toEqual({ start: false, reason: "backing off after a failed start" });
    expect(routineStartDecision(input({ lastFailureAt: minutesAgo(11), lastAttemptAt: minutesAgo(11) })).start).toBe(true);
  });
  it("tries at most once every 3 minutes", () => {
    expect(routineStartDecision(input({ lastAttemptAt: minutesAgo(2) })).start).toBe(false);
    expect(routineStartDecision(input({ lastAttemptAt: minutesAgo(3) })).start).toBe(true);
  });
  it("starts when a run claimed 2.5 minutes ago but nothing is processing any more", () => {
    // The policy reads live state only: a finished (or released) claim is no sign of a live run.
    expect(routineStartDecision(input({ newestProcessingClaimAt: null })).start).toBe(true);
    expect(routineStartDecision(input({ lastAttemptAt: minutesAgo(4), newestProcessingClaimAt: null })).start).toBe(true);
  });
  it("leaves the call to a run that claimed something in the last 20 minutes", () => {
    expect(routineStartDecision(input({ newestProcessingClaimAt: minutesAgo(1) }))).toEqual({ start: false, reason: "a run is working and takes ready calls next" });
    expect(routineStartDecision(input({ newestProcessingClaimAt: minutesAgo(40) })).start).toBe(true);
  });
  it("starts anyway when a call has waited 10 minutes beside a busy run", () => {
    expect(routineStartDecision(input({ newestProcessingClaimAt: minutesAgo(5), oldestReadyCallAt: minutesAgo(11) })).start).toBe(true);
    expect(routineStartDecision(input({ newestProcessingClaimAt: minutesAgo(5), oldestReadyCallAt: minutesAgo(9) })).start).toBe(false);
  });
});
