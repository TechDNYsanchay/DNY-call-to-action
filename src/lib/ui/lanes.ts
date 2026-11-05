// How action items split into the two ownership lanes, which rows sit in the "Needs review" tray,
// and the buckets of the My actions page. Pure.

import { daysUntil } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";

export type ItemStatus = Database["public"]["Enums"]["item_status"];
export type OwnerSide = Database["public"]["Enums"]["owner_side"];
export type Priority = Database["public"]["Enums"]["priority"];

export interface LaneItem {
  id: string;
  owed_by: OwnerSide;
  status: ItemStatus;
  confidence: number | null;
  evidence_verified: boolean;
  due_date: string | null;
}

export const OPEN_STATUSES: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["open", "in_progress"]);
export const isOpen = (item: Pick<LaneItem, "status">): boolean => OPEN_STATUSES.has(item.status);

/** Below this the row goes to the lane's collapsed "Needs review" tray. */
export const REVIEW_THRESHOLD = 0.5;
/** Below this the title gets a dashed underline and a "Check" chip. */
export const CHECK_THRESHOLD = 0.8;

export type LaneKey = "dny" | "client" | "unclear";

export const LANE_TITLES: Record<LaneKey, string> = { dny: "DNY owes", client: "Client owes", unclear: "Owner unclear" };

/** "both" counts in each lane because each side owes something, as the saved sheet counts do. */
export function laneOf(item: Pick<LaneItem, "owed_by">): LaneKey[] {
  if (item.owed_by === "both") return ["dny", "client"];
  if (item.owed_by === "unclear") return ["unclear"];
  return [item.owed_by];
}

export function needsReview(item: Pick<LaneItem, "confidence" | "evidence_verified">): boolean {
  return (item.confidence ?? 1) < REVIEW_THRESHOLD || !item.evidence_verified;
}

export function needsCheck(item: Pick<LaneItem, "confidence">): boolean {
  return (item.confidence ?? 1) < CHECK_THRESHOLD;
}

export interface Lane<T> {
  key: LaneKey;
  title: string;
  /** Open rows with solid evidence, in position order. */
  open: T[];
  /** Open rows the model was unsure about, collapsed at the lane end. */
  review: T[];
  done: T[];
}

/** Dropped and superseded rows are not shown on the sheet (they live in the audit trail). */
export function splitLanes<T extends LaneItem>(items: T[]): Lane<T>[] {
  const lanes: Record<LaneKey, Lane<T>> = {
    dny: { key: "dny", title: LANE_TITLES.dny, open: [], review: [], done: [] },
    client: { key: "client", title: LANE_TITLES.client, open: [], review: [], done: [] },
    unclear: { key: "unclear", title: LANE_TITLES.unclear, open: [], review: [], done: [] },
  };
  for (const item of items) {
    if (item.status === "dropped" || item.status === "superseded") continue;
    for (const key of laneOf(item)) {
      const lane = lanes[key];
      if (item.status === "done") lane.done.push(item);
      else if (needsReview(item)) lane.review.push(item);
      else lane.open.push(item);
    }
  }
  // The unclear lane only appears when it has something to say.
  return [lanes.dny, lanes.client, ...(lanes.unclear.open.length + lanes.unclear.review.length + lanes.unclear.done.length ? [lanes.unclear] : [])];
}

export interface SheetCounts {
  dny: number;
  client: number;
  overdue: number;
}

/** The scoreboard's open counts per lane (review-tray rows included: they are still owed). */
export function openCounts(items: LaneItem[], now: Date = new Date()): SheetCounts {
  let dny = 0;
  let client = 0;
  let overdue = 0;
  for (const item of items) {
    if (!isOpen(item)) continue;
    if (item.owed_by === "dny" || item.owed_by === "both") dny++;
    if (item.owed_by === "client" || item.owed_by === "both") client++;
    if (item.due_date && daysUntil(item.due_date, now) < 0) overdue++;
  }
  return { dny, client, overdue };
}

export type DueBucket = "overdue" | "today" | "week" | "later" | "none";

export const DUE_TITLES: Record<DueBucket, string> = { overdue: "Overdue", today: "Today", week: "This week", later: "Later", none: "No date" };

export function dueBucket(dueDate: string | null, now: Date = new Date()): DueBucket {
  if (!dueDate) return "none";
  const d = daysUntil(dueDate, now);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d < 7) return "week";
  return "later";
}

export interface DueGroup<T> {
  key: DueBucket;
  title: string;
  rows: T[];
}

/** My actions: overdue first, then today, this week, later, no date. Empty buckets left out. */
export function groupByDue<T extends { due_date: string | null }>(items: T[], now: Date = new Date()): DueGroup<T>[] {
  const buckets: Record<DueBucket, T[]> = { overdue: [], today: [], week: [], later: [], none: [] };
  for (const item of items) buckets[dueBucket(item.due_date, now)].push(item);
  for (const key of Object.keys(buckets) as DueBucket[]) buckets[key].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  return (Object.keys(buckets) as DueBucket[]).filter((k) => buckets[k].length).map((k) => ({ key: k, title: DUE_TITLES[k], rows: buckets[k] }));
}

/** P1 filled, P2 half, P3 none: shape carries the meaning, the word is in the title attribute. */
export const PRIORITY_WORDS: Record<Priority, string> = { high: "Urgent", medium: "Normal", low: "Low" };
