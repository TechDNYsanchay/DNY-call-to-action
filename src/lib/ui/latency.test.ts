import { describe, expect, it } from "vitest";
import { formatSpan, latencyRows, percentiles } from "./latency";

describe("percentiles", () => {
  it("takes the middle of an odd list and the mean of the two middles of an even one", () => {
    expect(percentiles([5, 1, 3], [50])).toEqual([3]);
    expect(percentiles([4, 1, 3, 2], [50])).toEqual([2.5]);
  });

  it("interpolates p95 between ranks", () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    const [p50, p95] = percentiles(values, [50, 95]);
    expect(p50).toBeCloseTo(10.5);
    expect(p95).toBeCloseTo(19.05);
    expect(percentiles([7], [50, 95])).toEqual([7, 7]);
  });

  it("gives NaN for an empty list", () => {
    const [p50, p95] = percentiles([], [50, 95]);
    expect(Number.isNaN(p50)).toBe(true);
    expect(Number.isNaN(p95)).toBe(true);
  });
});

describe("latencyRows", () => {
  const call = (endMin: number) => {
    const at = (min: number) => new Date(Date.UTC(2026, 10, 19, 10, min)).toISOString();
    return { call_ended_at: at(endMin), recording_seen_at: at(endMin + 1), stored_at: at(endMin + 2), transcribed_at: at(endMin + 2), ready_at: at(endMin + 2), first_claimed_at: at(endMin + 3), first_sheet_at: at(endMin + 5) };
  };

  it("measures every step and leaves out missing or negative spans", () => {
    const retried = { ...call(30), first_claimed_at: new Date(Date.UTC(2026, 10, 19, 10, 0)).toISOString() };
    const rows = latencyRows([call(0), call(10), { ...call(20), recording_seen_at: null }, retried]);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.link).toMatchObject({ p50: 60, n: 3 });
    expect(byKey.claim.n).toBe(3);
    expect(byKey.total).toMatchObject({ p50: 300, p95: 300, n: 4 });
  });

  it("formats spans for people", () => {
    expect(formatSpan(45)).toBe("45 s");
    expect(formatSpan(271)).toBe("4 min 31 s");
    expect(formatSpan(60)).toBe("1 min");
    expect(formatSpan(720)).toBe("12 min");
    expect(formatSpan(3900)).toBe("1 h 05 min");
    expect(formatSpan(NaN)).toBe("—");
  });
});
