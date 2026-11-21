import { describe, expect, it } from "vitest";
import { istDayStartIso, pollDue, pollWindows, quietWaitMs, shouldFetchMore } from "./schedule";

const at = (iso: string) => new Date(iso);

describe("quietWaitMs", () => {
  it("lets a request go outside Sales QA's minutes", () => {
    expect(quietWaitMs(at("2026-11-19T10:14:49Z"))).toBe(0);
    expect(quietWaitMs(at("2026-11-19T10:16:30Z"))).toBe(0);
    expect(quietWaitMs(at("2026-11-19T10:44:00Z"))).toBe(0);
  });
  it("waits from 10 s before to 90 s after :00, :15, :30 and :45", () => {
    expect(quietWaitMs(at("2026-11-19T10:14:50Z"))).toBe(100_000);
    expect(quietWaitMs(at("2026-11-19T10:15:30Z"))).toBe(60_000);
    expect(quietWaitMs(at("2026-11-19T10:16:00Z"))).toBe(30_000);
    expect(quietWaitMs(at("2026-11-19T10:00:05Z"))).toBe(85_000);
    expect(quietWaitMs(at("2026-11-19T10:01:29Z"))).toBe(1_000);
    expect(quietWaitMs(at("2026-11-19T10:29:55Z"))).toBe(95_000);
    expect(quietWaitMs(at("2026-11-19T10:46:00Z"))).toBe(30_000);
  });
  it("crosses the hour", () => {
    expect(quietWaitMs(at("2026-11-19T10:59:55Z"))).toBe(95_000);
    expect(quietWaitMs(at("2026-11-19T23:59:50Z"))).toBe(100_000);
  });
});

describe("pollDue", () => {
  it("polls every run by day, and every run at night unless an admin chose a slower night", () => {
    for (const iso of ["2026-11-19T05:02:00Z", "2026-11-19T05:04:00Z", "2026-11-19T17:58:00Z"]) {
      expect(pollDue(at(iso), 10)).toBe(true);
    }
    for (const iso of ["2026-11-19T20:04:00Z", "2026-11-19T02:58:00Z"]) expect(pollDue(at(iso), 2)).toBe(true);
  });
  it("with 10 at night, polls only in minutes ending in 2", () => {
    expect(pollDue(at("2026-11-19T20:02:00Z"), 10)).toBe(true);
    expect(pollDue(at("2026-11-19T20:12:30Z"), 10)).toBe(true);
    expect(pollDue(at("2026-11-19T20:04:00Z"), 10)).toBe(false);
    expect(pollDue(at("2026-11-19T20:10:00Z"), 10)).toBe(false);
    expect(pollDue(at("2026-11-19T02:52:00Z"), 10)).toBe(true);
    expect(pollDue(at("2026-11-19T18:00:00Z"), 10)).toBe(false);
  });
  it("with 30 at night, polls at :02 and :32", () => {
    expect(pollDue(at("2026-11-19T21:32:00Z"), 30)).toBe(true);
    expect(pollDue(at("2026-11-19T21:12:00Z"), 30)).toBe(false);
  });
});

describe("pollWindows", () => {
  // 00:10 IST on 20 Nov.
  const now = at("2026-11-19T18:40:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

  it("reads today, and today-2..today when the last wide read is 10 minutes old", () => {
    expect(pollWindows(now, minutesAgo(3), [])).toEqual([{ from: "2026-11-20", to: "2026-11-20", rereadDay: null }]);
    expect(pollWindows(now, minutesAgo(11), [])).toEqual([{ from: "2026-11-18", to: "2026-11-20", rereadDay: null }]);
    expect(pollWindows(now, null, [])).toEqual([{ from: "2026-11-18", to: "2026-11-20", rereadDay: null }]);
  });
  it("adds up to two re-read days from the last 14 days", () => {
    expect(pollWindows(now, minutesAgo(3), ["2026-11-10"])).toEqual([
      { from: "2026-11-20", to: "2026-11-20", rereadDay: null },
      { from: "2026-11-10", to: "2026-11-10", rereadDay: "2026-11-10" },
    ]);
    expect(pollWindows(now, minutesAgo(3), ["2026-11-01"])).toHaveLength(1);
    expect(pollWindows(now, minutesAgo(3), ["2026-11-06"])).toHaveLength(2);
    expect(pollWindows(now, minutesAgo(3), ["2026-11-21", "not a day"])).toHaveLength(1);
    const three = pollWindows(now, minutesAgo(3), ["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(three.map((w) => w.rereadDay)).toEqual([null, "2026-11-10", "2026-11-11"]);
  });
});

describe("istDayStartIso", () => {
  it("is midnight IST of the day the instant falls on", () => {
    expect(istDayStartIso(at("2026-11-19T20:00:00Z"))).toBe("2026-11-19T18:30:00.000Z");
    expect(istDayStartIso(at("2026-11-19T18:29:59Z"))).toBe("2026-11-18T18:30:00.000Z");
  });
});

describe("shouldFetchMore", () => {
  it("pages while the page was full and the total is unknown or not reached", () => {
    expect(shouldFetchMore(100, 100, null, 1)).toBe(true);
    expect(shouldFetchMore(100, 100, 230, 1)).toBe(true);
    expect(shouldFetchMore(100, 100, 100, 1)).toBe(false);
    expect(shouldFetchMore(37, 37, null, 1)).toBe(false);
    expect(shouldFetchMore(30, 230, 230, 3)).toBe(false);
  });
  it("stops after 10 pages", () => {
    expect(shouldFetchMore(100, 900, null, 9)).toBe(true);
    expect(shouldFetchMore(100, 1000, null, 10)).toBe(false);
  });
});
