// How long a business call takes from the end of the call to its sheet, step by step, over the last seven
// days (Settings > Phone calls). Pure. Percentiles interpolate between ranks, so p50 of an even list is the
// mean of its two middle values.

/** The p-th percentiles (0-100) of the values, in the order asked; NaN for each when there are none. */
export function percentiles(values: number[], ps: number[]): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return ps.map(() => NaN);
  return ps.map((p) => {
    const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
  });
}

/** The phone_calls times one latency row needs. */
export interface LatencyCall {
  call_ended_at: string;
  recording_seen_at: string | null;
  stored_at: string;
  transcribed_at: string | null;
  ready_at: string | null;
  first_claimed_at: string | null;
  first_sheet_at: string | null;
}

type TimeKey = keyof LatencyCall;

const STEPS: Array<{ key: string; label: string; from: TimeKey; to: TimeKey }> = [
  { key: "link", label: "Call end → link seen", from: "call_ended_at", to: "recording_seen_at" },
  { key: "copy", label: "Link seen → copied", from: "recording_seen_at", to: "stored_at" },
  { key: "transcribe", label: "Copied → transcribed", from: "stored_at", to: "transcribed_at" },
  { key: "claim", label: "Ready → routine picked it up", from: "ready_at", to: "first_claimed_at" },
  { key: "sheet", label: "Picked up → sheet", from: "first_claimed_at", to: "first_sheet_at" },
  { key: "total", label: "Total", from: "call_ended_at", to: "first_sheet_at" },
];

export interface LatencyRow {
  key: string;
  label: string;
  /** Seconds; NaN when no call had both times. */
  p50: number;
  p95: number;
  n: number;
}

/** One row per step; a step with a missing or negative span (a retried call) leaves that call out. */
export function latencyRows(calls: LatencyCall[]): LatencyRow[] {
  return STEPS.map((step) => {
    const spans: number[] = [];
    for (const c of calls) {
      const from = Date.parse(c[step.from] ?? "");
      const to = Date.parse(c[step.to] ?? "");
      if (Number.isFinite(from) && Number.isFinite(to) && to >= from) spans.push((to - from) / 1000);
    }
    const [p50, p95] = percentiles(spans, [50, 95]);
    return { key: step.key, label: step.label, p50, p95, n: spans.length };
  });
}

/** "45 s", "4 min 31 s", "12 min", "1 h 05 min"; an em dash when unknown. */
export function formatSpan(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
