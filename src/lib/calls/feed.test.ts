import { describe, expect, it } from "vitest";
import { type CallFeedStatus, feedSummary, type LedgerBuckets, parseFeedStatus } from "./feed";
import type { TodayStats } from "./types";

const ledger = (over: Partial<LedgerBuckets> = {}): LedgerBuckets => ({
  waitingRecording: 0,
  copying: 0,
  noRecording: 0,
  copyFailed: 0,
  inProgress: 0,
  sheets: 0,
  needsDecision: 0,
  failed: 0,
  notWork: 0,
  noSpeech: 0,
  ...over,
});

const poll = (over: Partial<TodayStats> = {}): TodayStats => ({ day: "2026-11-19", onLines: 0, candidates: 0, short: 0, tooLong: 0, internal: 0, beforeOn: 0, lines: {}, ...over });

const status = (over: Partial<CallFeedStatus> = {}): CallFeedStatus => ({
  paused: false,
  pipelinePaused: false,
  linesOn: 2,
  lastRunAt: null,
  lastPollOkAt: null,
  off: null,
  pollError: null,
  sttError: null,
  copyError: null,
  poll: null,
  ledger: ledger(),
  minutesToday: 0,
  ...over,
});

const adds = (s: ReturnType<typeof feedSummary>) => s.sheets + s.inProgress + s.needPerson + s.notAnalysed;

describe("feedSummary", () => {
  it("puts every call of the day in exactly one of four groups that add up to the total", () => {
    const s = feedSummary(
      status({
        poll: poll({ onLines: 12, candidates: 8, short: 2, tooLong: 0, internal: 1, beforeOn: 1 }),
        ledger: ledger({ sheets: 3, inProgress: 1, copying: 1, waitingRecording: 1, needsDecision: 1, noRecording: 0, notWork: 1 }),
      }),
    );
    expect(s).toMatchObject({ total: 12, sheets: 3, inProgress: 3, needPerson: 1, notAnalysed: 5 });
    expect(adds(s)).toBe(s.total);
  });

  it("lists only the buckets that are not zero, in a fixed order, in words", () => {
    const s = feedSummary(
      status({
        poll: poll({ onLines: 9, candidates: 6, short: 2, beforeOn: 1 }),
        ledger: ledger({ sheets: 3, waitingRecording: 1, noRecording: 1, notWork: 1 }),
      }),
    );
    expect(s.details.map((d) => d.text)).toEqual([
      "3 with a sheet",
      "1 still waiting for the phone to upload the recording",
      "2 too short or not answered",
      "1 before the line was switched on",
      "1 recording empty or never uploaded",
      "1 not a work call",
    ]);
    expect(s.details.every((d) => d.count > 0)).toBe(true);
    expect(feedSummary(status({ ledger: ledger({ notWork: 2, noRecording: 3 }) })).details.map((d) => d.text)).toEqual(["3 recordings empty or never uploaded", "2 not work calls"]);
  });

  it("before today's first poll, the total is the ledger's", () => {
    const s = feedSummary(status({ poll: null, ledger: ledger({ sheets: 2, failed: 1, copyFailed: 1, noSpeech: 1 }) }));
    expect(s).toMatchObject({ total: 5, sheets: 2, needPerson: 2, notAnalysed: 1 });
    expect(adds(s)).toBe(s.total);
  });

  it("counts candidates the ledger lost track of as not analysed, and grows the total for a ledger ahead of the poll", () => {
    const behind = feedSummary(status({ poll: poll({ onLines: 5, candidates: 4, short: 1 }), ledger: ledger({ sheets: 3 }) }));
    expect(behind).toMatchObject({ total: 5, notAnalysed: 2 });
    expect(behind.details.at(-1)).toEqual({ key: "other", count: 1, text: "1 not analysed for another reason" });
    const ahead = feedSummary(status({ poll: poll({ onLines: 3, candidates: 2, short: 1 }), ledger: ledger({ sheets: 3 }) }));
    expect(ahead.total).toBe(4);
    expect(adds(ahead)).toBe(ahead.total);
  });

  it("is all zeros on a quiet day", () => {
    expect(feedSummary(status())).toEqual({ total: 0, sheets: 0, inProgress: 0, needPerson: 0, notAnalysed: 0, details: [] });
  });
});

describe("parseFeedStatus", () => {
  it("reads calls_feed_status()'s JSON", () => {
    const parsed = parseFeedStatus({
      paused: false,
      pipelinePaused: false,
      linesOn: 2,
      lastRunAt: "2026-11-19T09:00:00Z",
      lastPollOkAt: "2026-11-19T09:00:00Z",
      off: null,
      pollError: null,
      sttError: "cap",
      copyError: { kind: "host", host: "cdn.callyzer.co", at: "2026-11-19T08:58:00Z" },
      poll: poll({ onLines: 1, candidates: 1 }),
      ledger: { sheets: 1, inProgress: 0 },
      minutesToday: 12,
    });
    expect(parsed).toMatchObject({ paused: false, linesOn: 2, sttError: "cap", copyError: { kind: "host", host: "cdn.callyzer.co" }, minutesToday: 12 });
    expect(parsed?.ledger).toEqual(ledger({ sheets: 1 }));
  });
  it("is null for a person not on the team (the function returns null) and safe on odd input", () => {
    expect(parseFeedStatus(null)).toBeNull();
    expect(parseFeedStatus([])).toBeNull();
    expect(parseFeedStatus({})).toMatchObject({ paused: true, poll: null, copyError: null, ledger: ledger() });
  });
});
