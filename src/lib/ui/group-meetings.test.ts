import { describe, expect, it } from "vitest";
import { groupMeetings, inboxGroupOf, istDaysAgo } from "./group-meetings";

// 2026-11-04 10:30 IST = 05:00 UTC
const now = new Date("2026-11-04T05:00:00Z");

describe("inbox grouping", () => {
  it("counts IST days, not UTC days", () => {
    // 01:30 IST on 4 Nov is 20:00 UTC on 3 Nov: still today in India.
    expect(istDaysAgo("2026-11-03T20:00:00Z", now)).toBe(0);
    expect(istDaysAgo("2026-11-03T05:00:00Z", now)).toBe(1);
    expect(istDaysAgo("2026-10-20T05:00:00Z", now)).toBe(15);
  });

  it("pins decisions, then the pipeline, then days", () => {
    expect(inboxGroupOf({ process_status: "needs_decision", happened_at: "2026-10-01T00:00:00Z" }, now)).toBe("decision");
    expect(inboxGroupOf({ process_status: "failed", happened_at: "2026-10-01T00:00:00Z" }, now)).toBe("decision");
    expect(inboxGroupOf({ process_status: "ready", happened_at: "2026-10-01T00:00:00Z" }, now)).toBe("processing");
    expect(inboxGroupOf({ process_status: "done", happened_at: "2026-11-04T03:00:00Z" }, now)).toBe("today");
    expect(inboxGroupOf({ process_status: "done", happened_at: "2026-11-01T03:00:00Z" }, now)).toBe("week");
    expect(inboxGroupOf({ process_status: "done", happened_at: "2026-10-01T03:00:00Z" }, now)).toBe("earlier");
  });

  it("drops empty groups and keeps order", () => {
    const groups = groupMeetings(
      [
        { id: 1, process_status: "done" as const, happened_at: "2026-10-01T03:00:00Z" },
        { id: 2, process_status: "processing" as const, happened_at: "2026-11-04T03:00:00Z" },
        { id: 3, process_status: "done" as const, happened_at: "2026-11-04T03:00:00Z" },
      ],
      now,
    );
    expect(groups.map((g) => g.key)).toEqual(["processing", "today", "earlier"]);
    expect(groups[0].title).toBe("Processing");
  });
});
