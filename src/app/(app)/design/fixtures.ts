// Sample data for the dev-only /design route: a meeting in every state, action rows in every
// visual state, and the example sheet the routine guide ships with. Nothing here touches the database.

import example from "../../../../agent/example-sheet.json";
import type { ActionItemRow, InboxRow, MeetingSummary, PersonSummary } from "@/lib/data/types";
import type { Attendee } from "@/lib/ui/participants";
import type { ProcessStatus } from "@/lib/ui/status";
import { readSheetResult } from "@/lib/ui/sheet-result";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

export const sampleClient = { id: "11111111-1111-4111-8111-111111111111", name: "Saffron Court Hotel" };

export function sampleMeeting(status: ProcessStatus, over: Partial<MeetingSummary> = {}): MeetingSummary {
  return {
    id: `00000000-0000-4000-8000-00000000000${["new", "waiting_transcript", "ready", "processing", "needs_decision", "done", "failed", "skipped"].indexOf(status)}`,
    tldv_meeting_id: `sample-${status}`,
    title: "Saffron Court | October review",
    happened_at: hoursAgo(3),
    duration_sec: 1800,
    organizer_email: "priya.nair@dnyhospitality.com",
    organizer_name: "Priya Nair",
    tldv_url: "https://app.tldv.io/meetings/sample",
    type: status === "skipped" ? "sales" : "client",
    type_source: status === "needs_decision" ? "llm" : "rule",
    type_confidence: status === "needs_decision" ? 0.62 : 0.95,
    type_reason: status === "needs_decision" ? "Internal debrief about a new property whose owner has signed an agreement; could be onboarding or a pre-sales visit." : "saffroncourt.in is a domain of Saffron Court Hotel",
    client_id: status === "needs_decision" ? null : sampleClient.id,
    client_name_guess: status === "needs_decision" ? "Grand Meridian" : null,
    transcript_ready: !["new", "waiting_transcript"].includes(status),
    process_status: status,
    process_attempts: status === "failed" ? 3 : status === "done" ? 1 : 0,
    claimed_at: status === "processing" ? hoursAgo(0.1) : null,
    failure_reason: status === "failed" ? "The routine gave up after 3 attempts: evidence quotes could not be matched to the transcript (speaker labels are generic and large parts are inaudible)" : null,
    source: "seed",
    created_at: hoursAgo(4),
    updated_at: hoursAgo(1),
    client: status === "needs_decision" ? null : sampleClient,
    ...over,
  };
}

export const inboxRows: InboxRow[] = [
  { ...sampleMeeting("needs_decision"), headline: null, counts: { dny: 0, client: 0, decisions: 0 } },
  { ...sampleMeeting("failed"), headline: null, counts: { dny: 0, client: 0, decisions: 0 } },
  { ...sampleMeeting("waiting_transcript"), headline: null, counts: { dny: 0, client: 0, decisions: 0 } },
  { ...sampleMeeting("ready"), headline: null, counts: { dny: 0, client: 0, decisions: 0 } },
  { ...sampleMeeting("processing"), headline: null, counts: { dny: 0, client: 0, decisions: 0 } },
  { ...sampleMeeting("done"), headline: example.headline, counts: { dny: 4, client: 2, decisions: 3 } },
  { ...sampleMeeting("skipped"), headline: null, counts: { dny: 0, client: 0, decisions: 0 } },
];

export const sheetView = readSheetResult({ ...example, verification: { evidence_verified: { D2: false } } });

export const people: PersonSummary[] = [
  { id: "p1", full_name: "Priya Nair", email: "priya.nair@dnyhospitality.com", role: "member", dept: "accounts", active: true },
  { id: "p2", full_name: "Arjun Mehta", email: "arjun.mehta@dnyhospitality.com", role: "member", dept: "operations", active: true },
  { id: "p3", full_name: "Meera Iyer", email: "meera.iyer@dnyhospitality.com", role: "admin", dept: "tech", active: false },
];

export const attendees: Attendee[] = [
  { name: "Priya Nair", email: "priya.nair@dnyhospitality.com", side: "dny", is_organizer: true },
  { name: "Arjun Mehta", email: "arjun.mehta@dnyhospitality.com", side: "dny", is_organizer: false },
  { name: "Rakesh Agarwal", email: "rakesh@saffroncourt.in", side: "client", is_organizer: false },
  { name: "Sunita Rao", email: "gm@saffroncourt.in", side: "client", is_organizer: false },
];

function item(over: Partial<ActionItemRow> & { id: string; title: string }): ActionItemRow {
  return {
    meeting_id: sampleMeeting("done").id,
    sheet_id: null,
    item_key: over.id,
    position: 0,
    details: "",
    owed_by: "dny",
    owner_name: null,
    owner_email: null,
    owner_basis: "not_stated",
    due_date: null,
    due_kind: "none_stated",
    due_phrase: null,
    priority: "medium",
    status: "open",
    evidence_ts_sec: 754,
    evidence_speaker: "Rakesh Agarwal",
    evidence_quote: "Sorry se kaam nahi chalega Priya. Mujhe fix chahiye.",
    evidence_verified: true,
    confidence: 0.92,
    linked_decision: null,
    edited_by: null,
    edited_at: null,
    done_at: null,
    done_by: null,
    erp_task_id: null,
    erp_sync_status: "not_applicable",
    ...over,
  };
}

export const dnyItems: ActionItemRow[] = [
  item({ id: "a1", title: "Send October MIS to the owner", details: "Monthly MIS by the 5th from now on; weekly MIS every Monday before 10 am.", owner_name: "Priya Nair", owner_email: "priya.nair@dnyhospitality.com", due_date: daysFromNow(1), due_phrase: "this Thursday", priority: "high" }),
  item({ id: "a2", title: "Share revised duty roster with the GM", owner_name: "Arjun Mehta", owner_email: "arjun.mehta@dnyhospitality.com", due_date: daysFromNow(-2), priority: "medium" }),
  item({ id: "a3", title: "Prepare direct-booking plan for the next review", due_date: daysFromNow(7), priority: "low", edited_at: new Date().toISOString() }),
  item({ id: "a4", title: "Confirm the chef's joining date", confidence: 0.7, owner_name: "Arjun Mehta", evidence_quote: "Chef kab join karega, confirm karo.", evidence_speaker: "Sunita Rao" }),
  item({ id: "a5", title: "Check the laundry vendor's revised rates", confidence: 0.42, evidence_verified: false, evidence_quote: "laundry wala rate badha raha hai" }),
  item({ id: "a6", title: "Fix the PMS export after the update", status: "done", done_at: new Date().toISOString(), owner_name: "Priya Nair" }),
];

export const clientItems: ActionItemRow[] = [
  item({ id: "c1", title: "Approve the New Year package proposal", owed_by: "client", owner_name: "Rakesh Agarwal", owner_email: "rakesh@saffroncourt.in", due_date: daysFromNow(7), priority: "medium", evidence_speaker: "Priya Nair", evidence_quote: "Rakesh ji, New Year package ka approval agle review tak de dijiye." }),
  item({ id: "c2", title: "Share the F&B payroll sheet", owed_by: "client", priority: "low" }),
];
