import { describe, expect, it } from "vitest";
import { dueBucket, groupByDue, needsCheck, needsReview, openCounts, splitLanes, type LaneItem } from "./lanes";

const item = (over: Partial<LaneItem> & { id: string }): LaneItem => ({ owed_by: "dny", status: "open", confidence: 0.9, evidence_verified: true, due_date: null, ...over });
// 2026-11-04 10:30 IST
const now = new Date("2026-11-04T05:00:00Z");

describe("lanes", () => {
  it("splits by side, counts 'both' in each lane and hides dropped rows", () => {
    const lanes = splitLanes([item({ id: "a" }), item({ id: "b", owed_by: "client" }), item({ id: "c", owed_by: "both" }), item({ id: "d", status: "dropped" }), item({ id: "e", status: "done" })]);
    expect(lanes.map((l) => l.key)).toEqual(["dny", "client"]);
    expect(lanes[0].open.map((i) => i.id)).toEqual(["a", "c"]);
    expect(lanes[0].done.map((i) => i.id)).toEqual(["e"]);
    expect(lanes[1].open.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("shows an unclear lane only when needed and sends weak rows to the review tray", () => {
    const lanes = splitLanes([item({ id: "a", owed_by: "unclear" }), item({ id: "b", confidence: 0.4 }), item({ id: "c", evidence_verified: false })]);
    expect(lanes.map((l) => l.key)).toEqual(["dny", "client", "unclear"]);
    expect(lanes[0].review.map((i) => i.id)).toEqual(["b", "c"]);
    expect(needsReview(item({ id: "x", confidence: 0.49 }))).toBe(true);
    expect(needsCheck(item({ id: "x", confidence: 0.79 }))).toBe(true);
    expect(needsCheck(item({ id: "x", confidence: 0.8 }))).toBe(false);
  });

  it("counts open items and overdue dates", () => {
    const counts = openCounts([item({ id: "a", due_date: "2026-11-01" }), item({ id: "b", owed_by: "both", due_date: "2026-11-10" }), item({ id: "c", status: "done", due_date: "2026-10-01" })], now);
    expect(counts).toEqual({ dny: 2, client: 1, overdue: 1 });
  });

  it("buckets due dates in IST days", () => {
    expect(dueBucket("2026-11-03", now)).toBe("overdue");
    expect(dueBucket("2026-11-04", now)).toBe("today");
    expect(dueBucket("2026-11-09", now)).toBe("week");
    expect(dueBucket("2026-12-01", now)).toBe("later");
    expect(dueBucket(null, now)).toBe("none");
    const groups = groupByDue([{ due_date: null }, { due_date: "2026-11-06" }, { due_date: "2026-11-05" }], now);
    expect(groups.map((g) => g.key)).toEqual(["week", "none"]);
    expect(groups[0].rows.map((r) => r.due_date)).toEqual(["2026-11-05", "2026-11-06"]);
  });
});
