// Matches a new sheet's action items to the rows already stored for the meeting, so a re-run
// updates rows in place instead of duplicating them, and never loses a row a person has edited or
// pushed to the ERP. Pure; the database work is in save.ts.

import { createHash } from "node:crypto";
import type { ActionItem } from "./schema";
import { tokenOverlap, tokensOf } from "./text";

const STOPWORDS = new Set(["the", "a", "an", "to", "of", "for", "with", "and", "by", "on", "in", "at", "from", "into", "their", "our", "its", "this", "that"]);

/** The title without filler words: "Share the revised roster with the owner" -> "share revised roster owner". */
export function titleStem(title: string): string {
  return tokensOf(title).filter((t) => !STOPWORDS.has(t)).join(" ");
}

/** Stable identity of an item across re-runs: the lane plus the title stem, hashed. */
export function itemKey(owedBy: string, title: string): string {
  return createHash("sha256").update(`${owedBy}|${titleStem(title)}`).digest("hex").slice(0, 16);
}

export interface ExistingItem {
  id: string;
  item_key: string;
  title: string;
  status: string;
  evidence_ts_sec: number | null;
  edited_by: string | null;
  erp_task_id: string | null;
}

export interface ItemMatch {
  item: ActionItem;
  /** The key the upsert must use (an existing row's key when it was reused). */
  key: string;
  existing: ExistingItem | null;
}

export interface MatchOutcome {
  matches: ItemMatch[];
  /** Existing rows the new sheet no longer contains and that nobody has edited or pushed. */
  supersededIds: string[];
  /** Edited or ERP-linked rows not in the new sheet: kept as they are. */
  keptIds: string[];
}

export const TS_WINDOW_SEC = 30;
export const TITLE_OVERLAP = 0.6;

/** Same key, or the same moment in the recording (within 30 s) with a title that mostly overlaps. */
export function sameItem(a: { key: string; title: string; tsSec: number | null }, b: ExistingItem): boolean {
  if (a.key === b.item_key) return true;
  if (a.tsSec === null || b.evidence_ts_sec === null) return false;
  if (Math.abs(a.tsSec - b.evidence_ts_sec) > TS_WINDOW_SEC) return false;
  return tokenOverlap(a.title, b.title) >= TITLE_OVERLAP || tokenOverlap(b.title, a.title) >= TITLE_OVERLAP;
}

export function matchItems(items: ActionItem[], existing: ExistingItem[], tsOf: (item: ActionItem) => number | null): MatchOutcome {
  const taken = new Set<string>();
  const usedKeys = new Set<string>();
  const matches: ItemMatch[] = items.map((item) => {
    const base = { key: itemKey(item.owed_by, item.title), title: item.title, tsSec: tsOf(item) };
    const found = existing.find((row) => !taken.has(row.id) && sameItem(base, row)) ?? null;
    let key = found ? found.item_key : base.key;
    // Two new items that collapse onto one key (near-identical titles) each need their own row.
    for (let n = 2; usedKeys.has(key); n++) key = `${found ? found.item_key : base.key}-${n}`;
    usedKeys.add(key);
    if (found) taken.add(found.id);
    return { item, key, existing: found };
  });
  const leftovers = existing.filter((row) => !taken.has(row.id));
  return {
    matches,
    supersededIds: leftovers.filter((r) => !r.edited_by && !r.erp_task_id && r.status !== "superseded").map((r) => r.id),
    keptIds: leftovers.filter((r) => r.edited_by || r.erp_task_id).map((r) => r.id),
  };
}
