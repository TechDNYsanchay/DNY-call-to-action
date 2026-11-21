import { describe, expect, it } from "vitest";
import type { CallFeedStatus } from "@/lib/calls/feed";
import { blocksFeed, callFailureText, callStage, callTabTitle, callTimeline, callTypeChip, callWho, feedProblems, formatCallWhen, type StageCall, type StageMeeting } from "./call-status";

// 2026-11-19 12:00 IST
const now = new Date("2026-11-19T06:30:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const opts = { now, pipelinePaused: false, claimTimeoutMin: 20, decisionHours: 24, undecidedFailedDays: 3 };

const meeting = (over: Partial<StageMeeting> = {}): StageMeeting => ({
  process_status: "waiting_transcript",
  type: "unknown",
  transcript_ready: false,
  claimed_at: null,
  updated_at: minutesAgo(1),
  failure_reason: null,
  type_reason: null,
  ...over,
});
const call = (over: Partial<StageCall> = {}): StageCall => ({
  stt_error_kind: null,
  stt_next_try_at: null,
  stored_at: minutesAgo(1),
  ready_at: null,
  decision_reason: null,
  decision_since: null,
  skip_code: null,
  ...over,
});

describe("callStage", () => {
  it("transcribing: usual, then taking longer after 5 minutes", () => {
    expect(callStage(meeting(), call(), opts)).toEqual({ key: "transcribing", word: "Transcribing", tone: "pulse", hint: "Usually under a minute." });
    expect(callStage(meeting(), call({ stored_at: minutesAgo(6) }), opts).hint).toBe("Taking longer than usual; it is retried automatically.");
  });

  it("transcribing with an error: key or credit, today's cap, a retry time, a pause", () => {
    expect(callStage(meeting(), call({ stt_error_kind: "auth" }), opts)).toMatchObject({ key: "transcribing_retry", tone: "slate", hint: "Paused: the transcription service refused the key or is out of credit." });
    expect(callStage(meeting(), call({ stt_error_kind: "credit" }), opts).hint).toBe("Paused: the transcription service refused the key or is out of credit.");
    expect(callStage(meeting(), call(), { ...opts, sttStop: "cap" }).hint).toBe("Today's limit is reached; it continues tomorrow.");
    // 12:05 IST
    expect(callStage(meeting(), call({ stt_error_kind: "server", stt_next_try_at: "2026-11-19T06:35:00Z" }), opts).hint).toBe("Retrying automatically at 12:05.");
    expect(callStage(meeting(), call({ stt_error_kind: "timeout", stt_next_try_at: minutesAgo(1) }), opts).hint).toBe("Being retried now.");
    expect(callStage(meeting(), call(), { ...opts, pipelinePaused: true })).toMatchObject({ key: "transcribing_retry", hint: "Paused by an admin." });
  });

  it("queued: usual, a pause, then taking longer after 6 minutes", () => {
    const ready = meeting({ process_status: "ready", transcript_ready: true, updated_at: minutesAgo(2) });
    expect(callStage(ready, call({ ready_at: minutesAgo(2) }), opts)).toEqual({ key: "queued", word: "Waiting for the next run", tone: "slate", hint: "Usually starts within a couple of minutes." });
    expect(callStage({ ...ready, updated_at: minutesAgo(7) }, call({ ready_at: minutesAgo(7) }), opts).hint).toBe("Taking longer than usual; a run is started automatically.");
    expect(callStage(ready, call({ ready_at: minutesAgo(2) }), { ...opts, pipelinePaused: true }).hint).toBe("Sheets are paused by an admin.");
    // A retry re-queues from its own change, not from the first transcript.
    expect(callStage(ready, call({ ready_at: minutesAgo(90) }), opts).hint).toBe("Usually starts within a couple of minutes.");
  });

  it("writing: usual, then the time the claim is released", () => {
    const writing = meeting({ process_status: "processing", transcript_ready: true, claimed_at: minutesAgo(3) });
    expect(callStage(writing, call(), opts)).toEqual({ key: "writing", word: "Analysing", tone: "pulse", hint: "Usually 2–4 minutes." });
    // claimed 11:51 IST + 20 min
    expect(callStage({ ...writing, claimed_at: minutesAgo(9) }, call(), opts).hint).toBe("Taking longer than usual; if the run stopped, it is retried by 12:11.");
  });

  it("decide: unsure calls say when they are deleted; held calls wait", () => {
    const decide = meeting({ process_status: "needs_decision", transcript_ready: true });
    expect(callStage(decide, call({ decision_reason: "unsure", decision_since: minutesAgo(60) }), opts)).toEqual({
      key: "decide",
      word: "Needs your decision",
      tone: "sienna",
      hint: "The routine was not sure this is a work call. Deleted at 11:00, 20 Nov unless someone decides.",
    });
    expect(callStage(decide, call({ decision_reason: "held", decision_since: minutesAgo(60) }), opts).hint).toBe("Held for a person to decide.");
  });

  it("done, not a work call, no speech", () => {
    expect(callStage(meeting({ process_status: "done", type: "client" }), call(), opts)).toEqual({ key: "done", word: "Sheet ready", tone: "bottle", hint: null });
    const reason = "Personal call. The recording and transcript were deleted.";
    expect(callStage(meeting({ process_status: "skipped", type_reason: reason }), call({ skip_code: "personal" }), opts)).toEqual({ key: "not_work", word: "Not a work call", tone: "muted", hint: reason });
    expect(callStage(meeting({ process_status: "skipped", type_reason: "No speech in the recording. The recording was deleted." }), call({ skip_code: "no_speech" }), opts)).toMatchObject({ key: "no_speech", word: "No speech" });
  });

  it("failed: the reason about a call, and when an undecided call is deleted", () => {
    const failed = meeting({ process_status: "failed", failure_reason: "The routine gave up on this meeting.", updated_at: "2026-11-19T06:00:00Z" });
    expect(callStage(failed, call(), opts)).toEqual({ key: "failed", word: "Failed", tone: "signal", hint: "The routine gave up on this call. Deleted on Sun 22 Nov unless someone retries or decides." });
    expect(callStage({ ...failed, type: "vendor" }, call(), opts).hint).toBe("The routine gave up on this call.");
    expect(callFailureText(null)).toBe("The call could not be processed.");
    expect(callFailureText("Meetings fail")).toBe("Calls fail");
  });
});

describe("callTimeline", () => {
  it("marks the step the call is on, with the stage's hint", () => {
    const steps = callTimeline(meeting({ process_status: "ready", transcript_ready: true }), call({ stored_at: "2026-11-19T06:12:00Z" }), "Usually starts within a couple of minutes.");
    expect(steps.map((s) => [s.key, s.state])).toEqual([
      ["received", "done"],
      ["transcribed", "done"],
      ["queued", "active"],
      ["analysing", "todo"],
      ["ready", "todo"],
    ]);
    expect(steps[0].label).toBe("Recording received at 11:42");
    expect(steps[2].hint).toBe("Usually starts within a couple of minutes.");
  });

  it("fails the transcription step or the analysis step", () => {
    expect(callTimeline(meeting({ process_status: "failed" }), call()).map((s) => s.state)).toEqual(["done", "failed", "todo", "todo", "todo"]);
    expect(callTimeline(meeting({ process_status: "failed", transcript_ready: true }), call()).map((s) => s.state)).toEqual(["done", "done", "todo", "failed", "todo"]);
    expect(callTimeline(meeting(), call())[1]).toMatchObject({ label: "Transcribing", state: "active" });
  });
});

describe("call words", () => {
  it("chips, who, the tab title and the time", () => {
    expect(callTypeChip("client")).toEqual({ label: "Client call", tone: "bottle" });
    expect(callTypeChip("vendor", true)).toEqual({ label: "Vendor", tone: "neutral" });
    expect(callTypeChip("unknown")).toBeNull();
    const masked = { counterpart_name: "Rakesh Cafe 89", counterpart_masked: "+91 98••• ••456" };
    expect(callWho({ type: "client", client: { name: "Cafe 89" }, client_name_guess: null }, masked)).toEqual({ text: "Cafe 89", masked: false });
    expect(callWho({ type: "vendor", client: null, client_name_guess: "Sharma Traders" }, masked)).toEqual({ text: "Rakesh Cafe 89", masked: false });
    expect(callWho({ type: "unknown", client: null, client_name_guess: null }, masked)).toEqual({ text: "+91 98••• ••456", masked: true });
    expect(callTabTitle("Cafe 89", "2026-11-18T06:10:00Z")).toBe("Cafe 89 · Call, 18 Nov 11:40");
    expect(formatCallWhen("2026-11-18T06:10:00Z", now)).toBe("Wed 18 Nov, 11:40");
    expect(formatCallWhen("2025-12-30T06:10:00Z", now)).toBe("Tue 30 Dec 2025, 11:40");
  });
});

const status = (over: Partial<CallFeedStatus> = {}): CallFeedStatus => ({
  paused: false,
  pipelinePaused: false,
  linesOn: 2,
  lastRunAt: minutesAgo(1),
  lastPollOkAt: minutesAgo(1),
  off: null,
  pollError: null,
  sttError: null,
  copyError: null,
  poll: null,
  ledger: { waitingRecording: 0, copying: 0, noRecording: 0, copyFailed: 0, inProgress: 0, sheets: 0, needsDecision: 0, failed: 0, notWork: 0, noSpeech: 0 },
  minutesToday: 0,
  ...over,
});

describe("feedProblems", () => {
  const admin = { isAdmin: true, capMinutes: 240, now };
  const member = { isAdmin: false, capMinutes: 240, now };
  const texts = (s: CallFeedStatus, o = admin) => feedProblems(s, o).map((p) => p.text);

  it("says a stopping switch alone", () => {
    expect(texts(status({ off: "not_configured", paused: true }))).toEqual(["Phone calls need the Callyzer and Deepgram keys on Vercel."]);
    expect(texts(status({ off: "not_configured" }), member)).toEqual(["Phone calls aren't switched on yet."]);
    expect(texts(status({ paused: true, pollError: "auth" }))).toEqual(["Phone calls are paused. Settings → Phone calls."]);
    expect(texts(status({ paused: true }), member)).toEqual(["Phone calls are paused."]);
    expect(texts(status({ linesOn: 0 }))).toEqual(["Choose which DNY phones to analyse in Settings → Phone calls."]);
    expect(texts(status({ linesOn: 0 }), member)).toEqual(["No phone lines are switched on yet."]);
    expect(texts(status({ off: "tripwire" }))).toEqual(["Refusing to run: this deployment points at a different database."]);
    expect(texts(status({ off: "tripwire" }), member)).toEqual([]);
    expect(blocksFeed(feedProblems(status({ paused: true }), member))).toBe(true);
  });

  it("names the poll, copy and transcription problems", () => {
    expect(texts(status({ pipelinePaused: true }), member)).toEqual(["Sheets are paused by an admin."]);
    expect(texts(status({ pollError: "add_on" }))[0]).toMatch(/^Callyzer refused the key/);
    expect(texts(status({ pollError: "auth" }), member)).toEqual(["New calls are delayed: the Callyzer connection needs an admin."]);
    expect(texts(status({ pollError: "rate", lastPollOkAt: minutesAgo(10) }))).toEqual([]);
    expect(texts(status({ pollError: "network", lastPollOkAt: minutesAgo(31) }))).toEqual(["Callyzer is slow to answer; retrying automatically."]);
    expect(texts(status({ pollError: "network", lastPollOkAt: minutesAgo(31) }), member)).toEqual([]);
    expect(texts(status({ copyError: { kind: "host", host: "cdn.example.com" } }))).toEqual(["Recordings can't be copied: Callyzer now serves them from cdn.example.com. Add it to RECORDING_HOSTS in src/lib/calls/media.ts."]);
    expect(texts(status({ copyError: { kind: "http" } }))).toEqual(["Recordings can't be copied (http); retrying automatically."]);
    expect(texts(status({ copyError: { kind: "http" } }), member)).toEqual([]);
    expect(texts(status({ sttError: "credit" }), member)).toEqual(["Transcription is paused; an admin has been told."]);
    expect(texts(status({ sttError: "cap" }))).toEqual(["Today's transcription limit (240 min) is reached; calls continue tomorrow, or raise it in Settings."]);
    expect(feedProblems(null, admin)).toEqual([]);
  });
});
