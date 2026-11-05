// Inbox grouping: decisions first, then meetings still in the pipeline, then finished sheets by the
// day they happened (IST). Pure, so the order a manager sees is unit tested.

import { istDate } from "@/lib/format";
import type { ProcessStatus } from "./status";

export type InboxGroupKey = "decision" | "processing" | "today" | "week" | "earlier";

export interface InboxGroup<T> {
  key: InboxGroupKey;
  title: string;
  rows: T[];
}

export interface GroupableMeeting {
  process_status: ProcessStatus;
  happened_at: string;
}

export const GROUP_TITLES: Record<InboxGroupKey, string> = {
  decision: "Needs your decision",
  processing: "Processing",
  today: "Today",
  week: "This week",
  earlier: "Earlier",
};

const PIPELINE: ReadonlySet<ProcessStatus> = new Set<ProcessStatus>(["new", "waiting_transcript", "ready", "processing"]);

/** Days since the IST calendar date of `iso`, counted in whole IST days from `now`. */
export function istDaysAgo(iso: string, now: Date): number {
  const toUtcDay = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtcDay(istDate(now)) - toUtcDay(istDate(iso))) / 86_400_000);
}

export function inboxGroupOf(m: GroupableMeeting, now: Date): InboxGroupKey {
  if (m.process_status === "needs_decision" || m.process_status === "failed") return "decision";
  if (PIPELINE.has(m.process_status)) return "processing";
  const days = istDaysAgo(m.happened_at, now);
  if (days <= 0) return "today";
  if (days < 7) return "week";
  return "earlier";
}

/** Groups in display order; empty groups are left out so the list never shows an empty heading. */
export function groupMeetings<T extends GroupableMeeting>(rows: T[], now: Date = new Date()): InboxGroup<T>[] {
  const buckets: Record<InboxGroupKey, T[]> = { decision: [], processing: [], today: [], week: [], earlier: [] };
  for (const row of rows) buckets[inboxGroupOf(row, now)].push(row);
  return (Object.keys(buckets) as InboxGroupKey[]).filter((k) => buckets[k].length).map((k) => ({ key: k, title: GROUP_TITLES[k], rows: buckets[k] }));
}
