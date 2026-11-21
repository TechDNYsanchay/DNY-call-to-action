import { describe, expect, it } from "vitest";
import page from "@/lib/callyzer/fixtures/call-history-page.json";
import { type CallyzerRow, parseCallHistoryRow } from "@/lib/callyzer/parse";
import { batchLinesOf, buildLedgerRow, classifyCallRow, classifyCallRows, contactName, type RulesContext, soleMatchingPerson, todayStats } from "./rules";
import type { LineState, PersonLite } from "./types";

const rowOf = (raw: unknown): CallyzerRow => {
  const parsed = parseCallHistoryRow(raw);
  if (!("row" in parsed)) throw new Error(parsed.error);
  return parsed.row;
};

const rows = page.data.map(rowOf);
const [incoming, short, toSupport, onSupport, waiting, stub, missed, long] = rows;

const ASHWINI = "+919820000001";
const KEYUR = "+919820000002";
const SUPPORT = "+919820000003";
const SWITCHED_ON = "2026-11-18T00:00:00.000Z";

const lines = (over: Array<[string, LineState]> = []) =>
  new Map<string, LineState>([
    [ASHWINI, { id: "line-ashwini", enabled: true, analyseFrom: SWITCHED_ON }],
    [KEYUR, { id: "line-keyur", enabled: true, analyseFrom: SWITCHED_ON }],
    [SUPPORT, { id: "line-support", enabled: false, analyseFrom: null }],
    ...over,
  ]);

const ctx = (over: Partial<RulesContext> = {}): RulesContext => ({
  lines: lines(),
  dnyNumbers: new Set(),
  batchLines: batchLinesOf(rows),
  minDurationSec: 45,
  maxDurationSec: 90 * 60,
  ...over,
});

describe("classifyCallRow", () => {
  it("makes a connected client call on a line that is on a candidate, with its ledger row", () => {
    const verdict = classifyCallRow(incoming, ctx());
    expect(verdict).toMatchObject({ outcome: "candidate", lineId: "line-ashwini", lineOn: true });
    expect(verdict.ledger).toEqual({
      callyzer_id: incoming.uniqueId,
      line_id: "line-ashwini",
      direction: "incoming",
      call_started_at: "2026-11-19T14:06:00+05:30",
      duration_sec: 323,
      counterpart_e164: "+919820123456",
      counterpart_masked: "+91 98••• ••456",
      counterpart_name: "Rakesh Cafe 89",
      recording_url: "https://media1.callyzer.co/recordings/2026/11/19/fixture-1.mp3",
    });
  });

  it("counts calls under the minimum length as short", () => {
    expect(classifyCallRow(short, ctx()).outcome).toBe("short");
    expect(classifyCallRow({ ...short, durationSec: 44 }, ctx()).outcome).toBe("short");
    expect(classifyCallRow({ ...short, durationSec: 45 }, ctx()).outcome).toBe("candidate");
  });

  it("counts a call with another DNY line as internal, whether the line is registered or only in this batch", () => {
    expect(classifyCallRow(toSupport, ctx()).outcome).toBe("internal");
    expect(classifyCallRow(toSupport, ctx({ lines: new Map([[KEYUR, { id: "line-keyur", enabled: true, analyseFrom: SWITCHED_ON }]]) })).outcome).toBe("internal");
    expect(classifyCallRow(toSupport, ctx({ batchLines: new Set() })).outcome).toBe("internal");
  });

  it("counts a call with one of the other DNY numbers as internal", () => {
    expect(classifyCallRow(stub, ctx()).outcome).toBe("candidate");
    expect(classifyCallRow(stub, ctx({ dnyNumbers: new Set(["+919876500004"]) })).outcome).toBe("internal");
  });

  it("reports a line that is off (or unknown) before anything about the call itself", () => {
    expect(classifyCallRow(onSupport, ctx())).toEqual({ outcome: "line_off", lineId: "line-support", lineOn: false });
    expect(classifyCallRow({ ...onSupport, durationSec: 10 }, ctx()).outcome).toBe("line_off");
    expect(classifyCallRow(incoming, ctx({ lines: new Map() }))).toEqual({ outcome: "line_off", lineId: null, lineOn: false });
  });

  it("never analyses a call that started before the line was switched on", () => {
    const startedMs = Date.parse(incoming.startedAt);
    const at = (ms: number): RulesContext => ctx({ lines: lines([[ASHWINI, { id: "line-ashwini", enabled: true, analyseFrom: new Date(ms).toISOString() }]]) });
    expect(classifyCallRow(incoming, at(startedMs + 1000)).outcome).toBe("before_line_on");
    expect(classifyCallRow(incoming, at(startedMs)).outcome).toBe("candidate");
  });

  it("counts calls that never connected", () => {
    expect(classifyCallRow(missed, ctx())).toEqual({ outcome: "not_connected", lineId: "line-keyur", lineOn: true });
  });

  it("counts calls over the maximum length as too long", () => {
    expect(classifyCallRow(long, ctx()).outcome).toBe("too_long");
    expect(classifyCallRow({ ...long, durationSec: 5400 }, ctx()).outcome).toBe("candidate");
  });

  it("rejects a DNY number that is not a valid line", () => {
    expect(classifyCallRow({ ...incoming, employeeNumber: "1503" }, ctx())).toEqual({ outcome: "invalid_line", lineId: null, lineOn: false });
  });

  it("keeps a call with a hidden number as a candidate", () => {
    const verdict = classifyCallRow({ ...incoming, clientNumber: null }, ctx());
    expect(verdict.outcome).toBe("candidate");
    expect(verdict.ledger).toMatchObject({ counterpart_e164: null, counterpart_masked: "Hidden number" });
  });

  it("keeps a call still waiting for its recording as a candidate without a link", () => {
    expect(classifyCallRow(waiting, ctx()).ledger).toMatchObject({ recording_url: null, direction: "incoming", counterpart_name: "Sharma Traders" });
  });
});

describe("contactName", () => {
  it("keeps names and drops phone numbers", () => {
    expect(contactName("Rakesh Cafe 89")).toBe("Rakesh Cafe 89");
    expect(contactName("+91 98201 23456")).toBeNull();
    expect(contactName("9820123456")).toBeNull();
    expect(contactName("Ravi 98201-23456")).toBe("Ravi");
    expect(contactName("")).toBeNull();
    expect(contactName(null)).toBeNull();
    expect(contactName("A".repeat(200))).toHaveLength(120);
  });
  it("is what the ledger stores", () => {
    expect(buildLedgerRow({ ...incoming, clientName: "+91 98201 23456" }, "line-ashwini").counterpart_name).toBeNull();
  });
});

describe("todayStats", () => {
  const extra = (startedAt: string, uniqueId: string): CallyzerRow => ({ ...incoming, uniqueId, startedAt, durationSec: 60 });
  const results = classifyCallRows(
    [...rows, extra("2026-11-19T00:10:00+05:30", "early"), extra("2026-11-18T23:50:00+05:30", "yesterday"), rows[0]],
    ctx(),
  );

  it("counts today's rows on lines that are on, once each", () => {
    const stats = todayStats(results, "2026-11-19");
    expect(stats).toEqual({
      day: "2026-11-19",
      onLines: 8,
      candidates: 4,
      short: 2,
      tooLong: 1,
      internal: 1,
      beforeOn: 0,
      lines: {
        "line-ashwini": { calls: 4, candidates: 2, withLink: 2 },
        "line-keyur": { calls: 4, candidates: 2, withLink: 1 },
      },
    });
    expect(stats.onLines).toBe(stats.short + stats.tooLong + stats.internal + stats.beforeOn + stats.candidates);
  });

  it("uses IST days: 00:10 IST is today, 23:50 IST the day before is not", () => {
    expect(todayStats(results, "2026-11-18")).toMatchObject({ onLines: 1, candidates: 1 });
  });

  it("counts calls before the switch-on", () => {
    const later = ctx({ lines: lines([[ASHWINI, { id: "line-ashwini", enabled: true, analyseFrom: "2026-11-19T12:00:00+05:30" }]]) });
    const stats = todayStats(classifyCallRows(rows, later), "2026-11-19");
    expect(stats.beforeOn).toBe(1);
    expect(stats.onLines).toBe(stats.short + stats.tooLong + stats.internal + stats.beforeOn + stats.candidates);
  });
});

describe("soleMatchingPerson", () => {
  const ashwini: PersonLite = { id: "p1", full_name: "Ashwini Bhambani", email: "ashwini@dnyhospitality.com" };
  const keyur: PersonLite = { id: "p2", full_name: "Keyur Shah", email: "keyur@dnyhospitality.com" };

  it("finds the one person a line is named after", () => {
    expect(soleMatchingPerson("Ashwini Bhambani", [ashwini, keyur])).toBe(ashwini);
  });
  it("finds nobody for a line named after its purpose", () => {
    expect(soleMatchingPerson("keyur dny supply chain", [ashwini, keyur])).toBeNull();
  });
  it("finds nobody when two people match, or the match is inactive", () => {
    expect(soleMatchingPerson("Ashwini Bhambani", [ashwini, { ...ashwini, id: "p3" }])).toBeNull();
    expect(soleMatchingPerson("Ashwini Bhambani", [{ ...ashwini, active: false }])).toBeNull();
  });
});
