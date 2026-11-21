// What a call's sheet stores, decided before the one transaction that writes it (save_call_sheet). Pure, so
// it is tested without a database. Two things differ from a meeting. An owner's e-mail is looked up only for
// someone on DNY's side: the other party of a call is never on the team list, so a vendor called Rakesh must
// not get DNY's Rakesh Kumar's address. And every quote's second is refined once here (src/lib/calls/seek.ts),
// so the call page plays from the words, and a re-run matches its items by the same seconds.

import { secondsFrom } from "@/lib/format";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { CallContext } from "./load";
import { type ExistingItem, matchItems } from "./match-items";
import { type ActionItem, PROMPT_VERSION, type Sheet } from "./schema";
import type { SheetVerification } from "./save";
import { bestMatch } from "./text";
import type { RosterPerson } from "./transcript-lines";
import type { CheckResult } from "./verify";

type ActionItemRow = Database["public"]["Tables"]["action_items"]["Row"];

/** One item for save_call_sheet: the action_items columns except meeting_id and sheet_id, which it adds. */
export type CallItemRow = Pick<
  ActionItemRow,
  | "item_key"
  | "position"
  | "title"
  | "details"
  | "owed_by"
  | "owner_name"
  | "owner_email"
  | "owner_basis"
  | "due_date"
  | "due_kind"
  | "due_phrase"
  | "priority"
  | "status"
  | "evidence_ts_sec"
  | "evidence_speaker"
  | "evidence_quote"
  | "evidence_verified"
  | "confidence"
  | "linked_decision"
>;

/** A call sheet's verification block: the meeting's, plus the refined second of every quote by entry id. */
export interface CallSheetVerification extends SheetVerification {
  evidence_seconds: Record<string, number[]>;
}

/**
 * The owner's e-mail, for DNY-side owners only: `owner.side` "dny", or "unknown" on an item DNY owes. The
 * name is matched against the team list; anyone else (the client or vendor) gets none.
 */
export function ownerEmailForCall(item: ActionItem, ctx: { roster: RosterPerson[] }): string | null {
  const name = item.owner.name;
  if (!name) return null;
  const dnySide = item.owner.side === "dny" || (item.owner.side === "unknown" && item.owed_by === "dny");
  if (!dnySide) return null;
  return bestMatch(name, ctx.roster, (r) => r.full_name)?.email ?? null;
}

/** Names a call's sheet may use besides the transcript's: the line's people and the contact name saved on the phone. */
export function callParticipantNames(call: Pick<CallContext, "line" | "savedName">): string[] {
  return [...call.line.people.map((p) => p.name), ...(call.savedName ? [call.savedName] : [])];
}

/** The second an item's first quote is said: the refined second when there is one, else its marker. */
export function callItemSecond(item: ActionItem, refined: Record<string, number[]>): number | null {
  const sec = refined[item.id]?.[0];
  return sec !== undefined && Number.isFinite(sec) ? Math.floor(sec) : secondsFrom(item.evidence[0]?.timestamp ?? "");
}

export interface CallSaveInput {
  sheet: Sheet;
  /** Every action_items row already stored for the call. */
  existing: ActionItemRow[];
  check: CheckResult;
  /** refineEvidenceSeconds(sheet, turns). */
  refined: Record<string, number[]>;
  roster: RosterPerson[];
  now: Date;
}

/**
 * save_call_sheet's arguments, decided as a meeting's save decides them (save.ts): items matched to the stored
 * rows, rows a person edited kept as they are (only their place moves: p_reused), rows the sheet no longer
 * has superseded unless someone edited or pushed them.
 */
export function buildCallSaveArgs(input: CallSaveInput): {
  p_items: Json;
  p_reused: Json;
  p_superseded: string[];
  verification: CallSheetVerification;
  /** Edited or ERP-linked rows the new sheet no longer contains, kept as they are. */
  kept: number;
} {
  const { sheet, existing, check, refined, roster } = input;
  const outcome = matchItems(sheet.action_items, existing as ExistingItem[], (item) => callItemSecond(item, refined));
  const byId = new Map(existing.map((r) => [r.id, r]));
  const placed = outcome.matches.map((m, position) => ({ m, position, row: m.existing ? byId.get(m.existing.id) ?? null : null }));
  const items: CallItemRow[] = placed
    .filter(({ row }) => !row?.edited_by)
    .map(({ m, position, row }) => {
      const item = m.item;
      const ev = item.evidence[0];
      return {
        item_key: m.key,
        position,
        title: item.title,
        details: item.details,
        owed_by: item.owed_by,
        owner_name: item.owner.name,
        owner_email: ownerEmailForCall(item, { roster }),
        owner_basis: item.owner.basis,
        due_date: item.due.date,
        due_kind: item.due.kind,
        due_phrase: item.due.raw_phrase,
        priority: item.priority,
        // A row that came back after being dropped reopens; done or in-progress rows keep their state.
        status: row && row.status !== "superseded" && row.status !== "dropped" ? row.status : "open",
        evidence_ts_sec: callItemSecond(item, refined),
        evidence_speaker: ev?.speaker ?? null,
        evidence_quote: ev?.quote ?? null,
        evidence_verified: check.evidenceDetails[item.id]?.[0] ?? false,
        confidence: check.adjustedConfidence[item.id] ?? item.confidence,
        linked_decision: item.linked_decision_id,
      };
    });
  const reused = placed.filter(({ row }) => !!row?.edited_by).map(({ row, position }) => ({ id: row!.id, position }));
  return {
    p_items: items as unknown as Json,
    p_reused: reused,
    p_superseded: outcome.supersededIds,
    verification: {
      prompt_version: PROMPT_VERSION,
      checked_at: input.now.toISOString(),
      warnings: check.warnings,
      evidence_verified: check.evidenceVerified,
      adjusted_confidence: check.adjustedConfidence,
      evidence_seconds: refined,
    },
    kept: outcome.keptIds.length,
  };
}
