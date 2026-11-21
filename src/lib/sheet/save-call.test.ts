import { describe, expect, it } from "vitest";
import exampleCallSheet from "../../../agent/example-call-sheet.json";
import exampleCallTranscript from "../../../agent/example-call-transcript.json";
import { refineEvidenceSeconds } from "@/lib/calls/seek";
import type { Database } from "@/lib/supabase/database.types";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import { itemKey } from "./match-items";
import { buildCallSaveArgs, type CallItemRow, callItemSecond, callParticipantNames, ownerEmailForCall } from "./save-call";
import { type ActionItem, CallSheetSchema, PROMPT_VERSION } from "./schema";
import { checkSheet } from "./verify";

type ActionItemRow = Database["public"]["Tables"]["action_items"]["Row"];

const roster = [
  { full_name: "Ashwini Bhambani", email: "ashwini@dnyhospitality.com", dept: "Account management" },
  { full_name: "Rakesh Kumar", email: "rakesh.kumar@dnyhospitality.com", dept: "Operations" },
];

const item = (over: { owner?: Partial<ActionItem["owner"]>; owed_by?: ActionItem["owed_by"] } = {}): ActionItem => {
  const base = CallSheetSchema.parse(exampleCallSheet).action_items[0];
  return { ...base, owed_by: over.owed_by ?? base.owed_by, owner: { ...base.owner, ...over.owner } };
};

describe("ownerEmailForCall", () => {
  it("never gives the other party a DNY namesake's address", () => {
    expect(ownerEmailForCall(item({ owner: { name: "Rakesh", side: "client" }, owed_by: "client" }), { roster })).toBeNull();
    expect(ownerEmailForCall(item({ owner: { name: "Rakesh", side: "client" }, owed_by: "dny" }), { roster })).toBeNull();
  });
  it("looks up DNY's owners on the team list", () => {
    expect(ownerEmailForCall(item({ owner: { name: "Ashwini", side: "dny" } }), { roster })).toBe("ashwini@dnyhospitality.com");
    expect(ownerEmailForCall(item({ owner: { name: "Rakesh", side: "dny" } }), { roster })).toBe("rakesh.kumar@dnyhospitality.com");
    expect(ownerEmailForCall(item({ owner: { name: "Somebody Else", side: "dny" } }), { roster })).toBeNull();
  });
  it("treats an unknown side as DNY's only on an item DNY owes", () => {
    expect(ownerEmailForCall(item({ owner: { name: "Ashwini", side: "unknown" }, owed_by: "dny" }), { roster })).toBe("ashwini@dnyhospitality.com");
    expect(ownerEmailForCall(item({ owner: { name: "Ashwini", side: "unknown" }, owed_by: "client" }), { roster })).toBeNull();
    expect(ownerEmailForCall(item({ owner: { name: "Ashwini", side: "unknown" }, owed_by: "both" }), { roster })).toBeNull();
    expect(ownerEmailForCall(item({ owner: { name: null, side: "dny" } }), { roster })).toBeNull();
  });
});

describe("callParticipantNames", () => {
  it("adds the line's people and the saved contact name", () => {
    const line = { id: "l", name: "Ashwini's phone", people: [{ name: "Ashwini Bhambani", email: "a@dnyhospitality.com", role: null }], salesGetSheets: false };
    expect(callParticipantNames({ line, savedName: "Rakesh Cafe 89" })).toEqual(["Ashwini Bhambani", "Rakesh Cafe 89"]);
    expect(callParticipantNames({ line: { ...line, people: [] }, savedName: null })).toEqual([]);
  });
});

describe("buildCallSaveArgs", () => {
  const sheet = CallSheetSchema.parse(exampleCallSheet);
  const turns = exampleCallTranscript as SpeakerTurn[];
  const check = checkSheet(sheet, { kind: "call", turns, durationSec: 105, meetingDateIst: "2026-11-18", participantNames: ["Ashwini Bhambani", "Rakesh Cafe 89"], speakerLabels: ["Speaker 1", "Speaker 2"] });
  const refined = refineEvidenceSeconds(sheet, turns);
  const now = new Date("2026-11-18T06:20:00Z");
  const [a1, a2] = sheet.action_items;

  const stored = (over: Partial<ActionItemRow>): ActionItemRow => ({
    id: "row",
    meeting_id: "m",
    sheet_id: "old-sheet",
    item_key: "k",
    position: 0,
    title: "t",
    details: "",
    owed_by: "dny",
    owner_name: null,
    owner_email: null,
    owner_basis: null,
    due_date: null,
    due_kind: null,
    due_phrase: null,
    priority: "medium",
    status: "open",
    evidence_ts_sec: null,
    evidence_speaker: null,
    evidence_quote: null,
    evidence_verified: false,
    confidence: 0.5,
    linked_decision: null,
    edited_by: null,
    edited_at: null,
    done_at: null,
    done_by: null,
    erp_task_id: null,
    erp_sync_status: "not_applicable",
    created_at: "2026-11-18T06:00:00Z",
    updated_at: "2026-11-18T06:00:00Z",
    ...over,
  });

  it("writes every item without meeting_id or sheet_id, with refined seconds and DNY-only owner e-mails", () => {
    const args = buildCallSaveArgs({ sheet, existing: [], check, refined, roster, now });
    const items = args.p_items as unknown as CallItemRow[];
    expect(items).toHaveLength(2);
    for (const row of items) {
      expect(row).not.toHaveProperty("meeting_id");
      expect(row).not.toHaveProperty("sheet_id");
    }
    expect(items[0]).toMatchObject({ item_key: itemKey("dny", a1.title), position: 0, owner_name: "Ashwini Bhambani", owner_email: "ashwini@dnyhospitality.com", status: "open", evidence_verified: true });
    // The client-side owner is the saved contact name: no e-mail.
    expect(items[1]).toMatchObject({ item_key: itemKey("client", a2.title), position: 1, owner_name: "Rakesh Cafe 89", owner_email: null });
    // "Aur main revised menu costing ..." is said after "Perfect." in the turn that starts at 0:59.
    expect(refined.A1[0]).toBeGreaterThan(59);
    expect(items[0].evidence_ts_sec).toBe(Math.floor(refined.A1[0]));
    expect(items[1].evidence_ts_sec).toBe(Math.floor(refined.A2[0]));
    expect(args.p_reused).toEqual([]);
    expect(args.p_superseded).toEqual([]);
    expect(args.kept).toBe(0);
  });

  it("keeps a person's edits, supersedes what the sheet dropped, and keeps done items done", () => {
    const existing = [
      stored({ id: "edited", item_key: itemKey("dny", a1.title), title: "Send the costing (edited)", edited_by: "p1", evidence_ts_sec: 59 }),
      stored({ id: "done", item_key: itemKey("client", a2.title), title: a2.title, owed_by: "client", status: "done" }),
      stored({ id: "gone", item_key: "old-key", title: "Call the dairy supplier", evidence_ts_sec: 31 }),
      stored({ id: "pushed", item_key: "erp-key", title: "Book the tasting", erp_task_id: "erp-1" }),
    ];
    const args = buildCallSaveArgs({ sheet, existing, check, refined, roster, now });
    const items = args.p_items as unknown as CallItemRow[];
    // The edited row is only moved into place; its text is not rewritten.
    expect(args.p_reused).toEqual([{ id: "edited", position: 0 }]);
    expect(items.map((r) => r.item_key)).toEqual([itemKey("client", a2.title)]);
    expect(items[0]).toMatchObject({ position: 1, status: "done" });
    expect(args.p_superseded).toEqual(["gone"]);
    expect(args.kept).toBe(1);
  });

  it("stores the verification block with every entry's refined seconds", () => {
    const { verification } = buildCallSaveArgs({ sheet, existing: [], check, refined, roster, now });
    expect(verification).toEqual({
      prompt_version: PROMPT_VERSION,
      checked_at: "2026-11-18T06:20:00.000Z",
      warnings: [],
      evidence_verified: check.evidenceVerified,
      adjusted_confidence: check.adjustedConfidence,
      evidence_seconds: refined,
    });
    expect(Object.keys(verification.evidence_seconds)).toEqual(expect.arrayContaining(["A1", "A2", "D1", "F1", "F2", "R1", "next_meeting", "client_sentiment"]));
  });
});

describe("callItemSecond", () => {
  it("uses the refined second, else the marker", () => {
    const a1 = CallSheetSchema.parse(exampleCallSheet).action_items[0];
    expect(callItemSecond(a1, { A1: [60.73] })).toBe(60);
    expect(callItemSecond(a1, {})).toBe(59);
    expect(callItemSecond(a1, { A1: [] })).toBe(59);
  });
});
