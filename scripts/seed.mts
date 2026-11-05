// Seed data for local and UI work: two sample clients, four sample people (@sample.invalid), ten
// meetings covering every process status, three fictional transcripts, sheets and action items for
// the done meetings, routine runs and a few pipeline events. Every row is marked (source 'seed',
// @sample.invalid emails, clients named "Sample ...") so `--remove` can take it all out again.
// Idempotent: re-running updates the same rows and never duplicates.
//
//   npm run db:seed            insert or refresh
//   npm run db:seed -- --remove   delete every seed row

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { formatTimestamp } from "../src/lib/format";
import { itemKey } from "../src/lib/sheet/match-items";
import { type ActionItem, type Evidence, type Sheet, SheetSchema, PROMPT_VERSION } from "../src/lib/sheet/schema";
import { checkSheet } from "../src/lib/sheet/verify";
import type { Database, Json } from "../src/lib/supabase/database.types";
import type { SpeakerTurn } from "../src/lib/tldv/turns";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (run with tsx --env-file=.env.local)");
  process.exit(1);
}
const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const fail = (where: string, error: { message: string } | null) => {
  if (error) {
    console.error(`${where}: ${error.message}`);
    process.exit(1);
  }
};

// ---------------------------------------------------------------------------
// People and clients
// ---------------------------------------------------------------------------

const PEOPLE = [
  { full_name: "Priya Nair", email: "priya.nair@sample.invalid", role: "member" as const, dept: "accounts" },
  { full_name: "Arjun Mehta", email: "arjun.mehta@sample.invalid", role: "member" as const, dept: "operations" },
  { full_name: "Meera Iyer", email: "meera.iyer@sample.invalid", role: "admin" as const, dept: "tech" },
  { full_name: "Karan Shah", email: "karan.shah@sample.invalid", role: "member" as const, dept: "sales" },
];

const CLIENTS = [
  { name: "Sample Saffron Court Hotel", domains: ["saffroncourt-sample.invalid"], contact_emails: ["rakesh@saffroncourt-sample.invalid", "gm@saffroncourt-sample.invalid"], status: "active", notes: "Seed data. 48-key heritage hotel in Jaipur, F&B heavy." },
  { name: "Sample Blue Bay Resort", domains: ["bluebay-sample.invalid"], contact_emails: ["vikram@bluebay-sample.invalid"], status: "onboarding", notes: "Seed data. Beach resort in Alibaug, onboarding since October." },
];

const CONTACTS = {
  rakesh: { email: "rakesh@saffroncourt-sample.invalid", name: "Rakesh Agarwal" },
  sunita: { email: "gm@saffroncourt-sample.invalid", name: "Sunita Rao" },
  vikram: { email: "vikram@bluebay-sample.invalid", name: "Vikram Desai" },
  neha: { email: "neha.k@gmail-sample.invalid", name: "Neha Kulkarni" },
  prospect: { email: "owner@grandmeridian-sample.invalid", name: "Sanjay Bhatia" },
};

// ---------------------------------------------------------------------------
// Transcripts. Lines are [speaker, text]; timings are computed so markers stay consistent.
// ---------------------------------------------------------------------------

function turnsFrom(lines: [string, string][], gapSec: number, startSec = 20): SpeakerTurn[] {
  let t = startSec;
  return lines.map(([speaker, text]) => {
    const dur = Math.max(4, Math.round(text.split(/\s+/).length * 0.55 * 10) / 10);
    const turn = { speaker, startSec: Math.round(t * 10) / 10, endSec: Math.round((t + dur) * 10) / 10, text };
    t += dur + gapSec;
    return turn;
  });
}

const P = "Priya Nair";
const A = "Arjun Mehta";
const V = "Vikram Desai";
const N = "Neha Kulkarni";

// A. English operations review, Blue Bay Resort (onboarding), about 42 minutes.
const BLUE_BAY_LINES: [string, string][] = [
  [P, "Good afternoon Vikram, good afternoon Neha. Thanks for making time. This is our fortnightly operations review for Blue Bay."],
  [V, "Afternoon Priya. Neha is joining from the property, so she may drop if the network is bad."],
  [N, "I am here. The connection is fine for now."],
  [P, "Great. Agenda today: the onboarding checklist, housekeeping standards, the kitchen hiring, the pool licence, revenue for the first two weeks of November, and the guest feedback system."],
  [A, "I will start with the onboarding checklist. Of the 42 items, 31 are closed, 8 are in progress and 3 are blocked."],
  [A, "The three blocked items are the fire NOC renewal, the pool operator licence and the bar licence transfer to the new entity."],
  [V, "The bar licence is with my lawyer. He says the transfer takes six to eight weeks from the date of filing, and we filed on 20 October."],
  [A, "So we should expect it in the first half of December. We will keep the bar closed to walk-ins and serve in-room only until then."],
  [V, "Agreed, no risk with excise. In-room service only until the licence comes."],
  [P, "Noted as a decision. Neha, where are we on the fire NOC?"],
  [N, "The inspection happened on 28 October. They want two more extinguishers near the kitchen and signage on the first floor. Both are ordered."],
  [A, "Once they are installed, send me photographs and I will chase the certificate with the fire office."],
  [N, "I will send the photographs by Monday."],
  [P, "Good. Housekeeping standards. Arjun, you did the audit on Saturday."],
  [A, "Yes. Room readiness scored 78 out of 100. The misses were the mini bar restocking, bathroom amenities placement and the linen fold. Nothing structural."],
  [A, "We have retrained the four room attendants on the standard. I will re-audit in two weeks and we expect 90 plus."],
  [V, "Seventy eight is low for the rate we are charging. What rate are we at now?"],
  [A, "Average rate for the first two weeks of November is 9,800 rupees. Occupancy is 54 percent, mostly weekends."],
  [V, "Weekday occupancy is the problem then."],
  [P, "It is. We are proposing a weekday corporate offsite package for Mumbai companies: two nights, meals, one team activity, at 7,500 per person per night."],
  [V, "Send me the package deck and I will forward it to three HR heads I know."],
  [P, "I will send the deck to you by Thursday."],
  [N, "Can we also list the resort on the two corporate booking platforms? Guests keep asking if their company can book directly."],
  [A, "Yes. We will complete the listing on both platforms before the end of the month. That is on DNY."],
  [P, "Kitchen hiring next. We are short one sous chef and two commis."],
  [A, "We have shortlisted two sous chef candidates. Both are from Goa, salary expectation 55,000 to 60,000 per month."],
  [V, "That is above what I budgeted. I had 45,000 in the budget."],
  [A, "At 45,000 we will not get someone who can run a beach resort kitchen in season. We recommend 55,000 with a review after six months."],
  [V, "Okay, approve 55,000, but only one sous chef, and the commis you hire locally."],
  [A, "Understood. One sous chef at 55,000, two local commis. I will make the offer this week and the chef can join by 20 November."],
  [P, "Pool licence. Neha, has the operator certification been scheduled?"],
  [N, "The lifeguard training is on 12 November. The certificate comes a week after. Until then we keep the pool closed after 6 pm."],
  [V, "Guests complained about that last weekend."],
  [N, "Yes, two complaints. We are offering a free sunset cocktail on the deck instead. It is working so far."],
  [P, "Good recovery. Let us put the pool timing in the pre-arrival email so nobody is surprised."],
  [A, "I will update the pre-arrival email template today."],
  [V, "Now revenue. Priya, you promised a weekly flash report. I got one in two weeks."],
  [P, "You are right. The second one was late because the PMS export broke after the update. It is fixed. The flash report will go out every Monday by noon from now on."],
  [V, "Every Monday by noon. Please keep it."],
  [P, "We will."],
  [A, "On revenue: room revenue for 1 to 14 November is 39.6 lakh. F&B revenue is 11.2 lakh. Total 50.8 lakh against a budget of 55 for the half month."],
  [V, "So we are 8 percent behind budget."],
  [A, "Roughly, yes. The gap is weekday rooms. The weekend was ahead of budget."],
  [V, "And costs?"],
  [A, "Payroll is on budget at 14.5 lakh for the month. Food cost is 34 percent, a bit high because of the small volumes. Utilities are 20 percent over because the chiller ran all day in the heat."],
  [N, "The chiller timer was broken. The vendor fixed it yesterday."],
  [V, "Good. I want the utility number back in budget by December."],
  [A, "We will track it daily now that the timer works and show the trend in the flash report."],
  [P, "Guest feedback. We proposed the WhatsApp feedback link at checkout."],
  [N, "We started it on 5 November. Twelve responses so far, average 4.3 out of 5. Two complaints about the pool, one about slow breakfast service."],
  [V, "4.3 is fine for the first month. What about online reviews?"],
  [A, "Google rating is 4.5 with 38 reviews. We reply to every review within a day."],
  [V, "Keep doing that. One more thing, the staff uniforms. They still have the old logo."],
  [N, "The new uniforms are with the tailor. Delivery promised by 18 November."],
  [V, "Please make sure. I have guests from my company coming on the 21st."],
  [P, "Noted. Neha owns the uniform delivery by the 18th. Anything else before we close?"],
  [V, "Yes. I want to see the December festive plan. Christmas and New Year will decide the quarter."],
  [A, "We are drafting it. We will present the festive plan at the next review."],
  [P, "Next review is in two weeks, Wednesday 18 November, same time."],
  [V, "Fine. And Priya, Monday flash report."],
  [P, "Monday flash report, by noon. Thank you both."],
  [N, "Thank you, bye."],
  [A, "Thanks everyone."],
];

// C. Poor audio, generic labels. A property visit debrief where tl;dv could not tell speakers apart.
const POOR_AUDIO_LINES: [string, string][] = [
  ["Speaker 1", "Hello, can you hear me? Hello?"],
  ["Speaker 2", "Yes yes, now it is. Go ahead."],
  ["Speaker 1", "So we went to the property yesterday, the one near the highway."],
  ["Speaker 2", "Haan, the Saffron one or the other one?"],
  ["Speaker 1", "The other one. Rooms are okay, the lobby needs work. Lot of damp on the wall."],
  ["Speaker 3", "[inaudible] contractor said [inaudible] two weeks."],
  ["Speaker 2", "Two weeks for what? For the damp?"],
  ["Speaker 3", "For the damp and the painting both."],
  ["Speaker 1", "Owner was there. He said he wants to open by December first week."],
  ["Speaker 2", "That is very aggressive. Kitchen is not even ready."],
  ["Speaker 1", "I told him. He said kitchen equipment is coming from Delhi, already paid, something like eighteen lakh."],
  ["Speaker 3", "[inaudible] GST invoice [inaudible]."],
  ["Speaker 2", "Can you repeat? You are breaking."],
  ["Speaker 3", "I said we should ask for the GST invoice for the equipment, for the depreciation."],
  ["Speaker 2", "Okay, note that down. Who is going to ask?"],
  ["Speaker 1", "I will ask him when I send the visit report."],
  ["Speaker 2", "And when is the visit report going?"],
  ["Speaker 1", "Tomorrow, or day after latest."],
  ["Speaker 3", "Staff [inaudible] fourteen people [inaudible] from the old management."],
  ["Speaker 2", "Fourteen staff are continuing from the old management? Are they trained?"],
  ["Speaker 1", "Not trained the way we want. Housekeeping especially. We will need the SOP training before opening."],
  ["Speaker 2", "Who does the training, Arjun's team?"],
  ["Speaker 1", "Probably. Depends on his dates. He is in Alibaug till the 20th."],
  ["Speaker 3", "[inaudible]"],
  ["Speaker 2", "Sorry, we lost you again."],
  ["Speaker 3", "I was saying the owner also asked about the OTA listing. He wants us to handle it."],
  ["Speaker 1", "That is in the scope, yes. We can start once the photos are done."],
  ["Speaker 2", "Photos need the lobby fixed first. Otherwise we are selling damp walls."],
  ["Speaker 1", "Correct. So photos after the painting, end of November."],
  ["Speaker 2", "What about the rate? Did he say what he wants to charge?"],
  ["Speaker 1", "He mentioned 3,500 for a standard room. I think that is high for that location."],
  ["Speaker 3", "[inaudible] 2,800 [inaudible] competition."],
  ["Speaker 2", "You are saying competition is at 2,800?"],
  ["Speaker 3", "Yes, the two hotels on the same road are at 2,800 and 3,000."],
  ["Speaker 1", "We will put a rate recommendation in the report. Probably start at 2,999 and move up with reviews."],
  ["Speaker 2", "Fine. The agreement, is it signed?"],
  ["Speaker 1", "He signed, we have not countersigned. Legal has one comment on the termination clause."],
  ["Speaker 2", "Push legal. We cannot start work on an unsigned agreement."],
  ["Speaker 1", "I will follow up with legal today."],
  ["Speaker 3", "[inaudible] advance [inaudible] received."],
  ["Speaker 2", "The advance is received? Full or partial?"],
  ["Speaker 3", "Partial. Half of the first month."],
  ["Speaker 2", "Okay. Anything on the licences?"],
  ["Speaker 1", "FSSAI is in the old company's name. Needs a fresh application. Fire NOC is valid till March."],
  ["Speaker 2", "Fresh FSSAI takes three to four weeks. Start it now."],
  ["Speaker 1", "Owner has to apply, we can only help with documents."],
  ["Speaker 2", "Then tell him in the report, clearly, with the dates."],
  ["Speaker 3", "[inaudible] water [inaudible] tanker."],
  ["Speaker 2", "Water supply is by tanker?"],
  ["Speaker 3", "Yes, two tankers a day in summer. There is a borewell but it is not working."],
  ["Speaker 1", "That will be a cost item. Add it to the operating budget."],
  ["Speaker 2", "Okay. Let us stop here, the line is bad. Send the report and we will discuss on Thursday."],
  ["Speaker 1", "Thursday is fine. I will send it before that."],
  ["Speaker 3", "[inaudible] bye."],
  ["Speaker 2", "Bye."],
  ["Speaker 1", "Bye, thanks."],
  ["Speaker 2", "Oh wait, one more thing. Did he mention the restaurant franchise idea?"],
  ["Speaker 1", "Briefly. He wants a South Indian franchise on the ground floor. We said we will evaluate."],
  ["Speaker 2", "Okay, put that in the report as an open point."],
  ["Speaker 1", "Will do. Bye now."],
  ["Speaker 2", "Bye."],
];

// ---------------------------------------------------------------------------
// Sheets for the done meetings
// ---------------------------------------------------------------------------

/** Evidence copied from a turn so the server checks always verify it. */
const evidenceFrom = (turns: SpeakerTurn[], index: number, quote?: string, english: string | null = null): Evidence => ({
  timestamp: formatTimestamp(turns[index].startSec),
  speaker: turns[index].speaker,
  quote: quote ?? turns[index].text,
  quote_english: english,
});

function blueBaySheet(turns: SpeakerTurn[]): Sheet {
  const e = (i: number, quote?: string) => [evidenceFrom(turns, i, quote)];
  const item = (over: Partial<ActionItem> & Pick<ActionItem, "id" | "title" | "owed_by" | "evidence">): ActionItem => ({
    details: "",
    owner: { name: null, side: over.owed_by === "client" ? "client" : "dny", basis: "not_stated" },
    due: { kind: "none_stated", date: null, raw_phrase: null, basis: null },
    priority: "medium",
    linked_decision_id: null,
    confidence: 0.9,
    ...over,
  });
  return {
    headline: "Blue Bay is 8% behind budget on weekday rooms; DNY commits to a Monday flash report and a corporate offsite package; a sous chef is approved at 55,000.",
    executive_summary: [
      "First-half November revenue is 50.8 lakh against a 55 lakh budget, the gap entirely weekday rooms; DNY will send a corporate offsite package deck by Thursday and list the resort on two corporate booking platforms before month end.",
      "The owner was unhappy the weekly flash report came once in two weeks; DNY committed to every Monday by noon after fixing the PMS export.",
      "The owner approved one sous chef at 55,000 per month with local commis; the bar stays in-room only until the licence transfer lands in early December.",
    ],
    meeting_purpose: "operations",
    language_profile: { primary: "english", mixed: false, notes: null },
    action_items: [
      item({ id: "A1", title: "Send weekly flash report every Monday by noon", owed_by: "dny", owner: { name: "Priya Nair", side: "dny", basis: "volunteered" }, due: { kind: "relative_phrase", date: "2026-11-09", raw_phrase: "every Monday by noon from now on", basis: "meeting on Wed 4 Nov; first Monday = 9 Nov" }, priority: "high", evidence: e(37, "The flash report will go out every Monday by noon from now on."), details: "The second report was late because the PMS export broke after an update; it is fixed. The owner asked twice." }),
      item({ id: "A2", title: "Send corporate offsite package deck to the owner", owed_by: "dny", owner: { name: "Priya Nair", side: "dny", basis: "volunteered" }, due: { kind: "relative_phrase", date: "2026-11-05", raw_phrase: "by Thursday", basis: "meeting on Wed 4 Nov; Thursday = 5 Nov" }, evidence: e(21), details: "Two nights, meals, one team activity at 7,500 per person per night; the owner forwards it to three HR heads." }),
      item({ id: "A3", title: "List the resort on both corporate booking platforms", owed_by: "dny", due: { kind: "relative_phrase", date: "2026-11-30", raw_phrase: "before the end of the month", basis: "meeting in Nov 2026; month end = 30 Nov" }, evidence: e(23) }),
      item({ id: "A4", title: "Send fire NOC photographs after extinguishers and signage are installed", owed_by: "client", owner: { name: "Neha Kulkarni", side: "client", basis: "volunteered" }, due: { kind: "relative_phrase", date: "2026-11-09", raw_phrase: "by Monday", basis: "meeting on Wed 4 Nov; Monday = 9 Nov" }, evidence: e(12), details: "Two more extinguishers near the kitchen and first-floor signage were asked for at the 28 October inspection; Arjun chases the certificate once he has the photographs." }),
      item({ id: "A5", title: "Make the sous chef offer at 55,000 per month", owed_by: "dny", owner: { name: "Arjun Mehta", side: "dny", basis: "volunteered" }, due: { kind: "relative_phrase", date: null, raw_phrase: "this week", basis: "'this week' names no day; left open" }, linked_decision_id: "D2", evidence: e(29), details: "One sous chef at 55,000 with a review after six months; two commis hired locally. Joining targeted for 20 November." }),
      item({ id: "A6", title: "Update the pre-arrival email with pool timings", owed_by: "dny", owner: { name: "Arjun Mehta", side: "dny", basis: "volunteered" }, due: { kind: "relative_phrase", date: "2026-11-04", raw_phrase: "today", basis: "the meeting day, 4 Nov" }, priority: "low", evidence: e(35) }),
      item({ id: "A7", title: "Deliver new staff uniforms before the owner's guests arrive", owed_by: "client", owner: { name: "Neha Kulkarni", side: "client", basis: "explicitly_assigned" }, due: { kind: "explicit_date", date: "2026-11-18", raw_phrase: "by 18 November", basis: "explicit date" }, evidence: e(55), details: "The tailor promised delivery by the 18th; the owner's company guests arrive on the 21st." }),
      item({ id: "A8", title: "Present the December festive plan at the next review", owed_by: "dny", due: { kind: "relative_phrase", date: "2026-11-18", raw_phrase: "at the next review", basis: "next review fixed for Wed 18 Nov" }, evidence: e(57), details: "Christmas and New Year will decide the quarter, the owner said." }),
      item({ id: "A9", title: "Bring utilities back within budget by December", owed_by: "dny", due: { kind: "relative_phrase", date: null, raw_phrase: "by December", basis: "'by December' names no day; left open" }, confidence: 0.45, evidence: e(46, "I want the utility number back in budget by December."), details: "Utilities ran 20% over because the chiller timer was broken; it was fixed yesterday and DNY tracks it daily." }),
    ],
    decisions: [
      { id: "D1", statement: "The bar stays closed to walk-ins and serves in-room only until the licence transfer completes.", decided_by: "joint", evidence: e(8), confidence: 0.95 },
      { id: "D2", statement: "One sous chef is approved at 55,000 per month; the two commis are hired locally.", decided_by: "client", evidence: e(28), confidence: 0.95 },
    ],
    key_facts: [
      { id: "F1", fact: "Room revenue for 1 to 14 November is 39.6 lakh and F&B 11.2 lakh, total 50.8 lakh against a 55 lakh budget.", category: "money", normalized_value: "INR 5080000 vs budget 5500000", evidence: e(40), confidence: 0.95 },
      { id: "F2", fact: "Average rate is 9,800 rupees at 54% occupancy, mostly weekends.", category: "metric", normalized_value: "ARR 9800; occupancy 54%", evidence: e(17), confidence: 0.95 },
      { id: "F3", fact: "Payroll is on budget at 14.5 lakh for the month; food cost is 34%; utilities are 20% over budget.", category: "money", normalized_value: "INR 1450000 payroll; 34% food cost", evidence: e(44), confidence: 0.9 },
      { id: "F4", fact: "Room readiness audit scored 78 out of 100; re-audit in two weeks targets 90 plus.", category: "metric", normalized_value: "78/100", evidence: e(14), confidence: 0.95 },
      { id: "F5", fact: "The bar licence transfer was filed on 20 October and takes six to eight weeks.", category: "date", normalized_value: "2026-10-20 filing; expected early Dec", evidence: e(6), confidence: 0.9 },
      { id: "F6", fact: "The onboarding checklist has 31 of 42 items closed, 8 in progress and 3 blocked.", category: "quantity", normalized_value: "31/42 closed", evidence: e(4), confidence: 0.95 },
    ],
    risks: [
      { id: "R1", description: "Weekday occupancy is weak and the first half of November is 8% behind budget.", severity: "high", affects: "client", mitigation_discussed: "Corporate offsite package and corporate platform listings.", evidence: e(41), confidence: 0.9 },
      { id: "R2", description: "Pool closed after 6 pm until the lifeguard certificate arrives; two guest complaints already.", severity: "medium", affects: "client", mitigation_discussed: "Free sunset cocktail on the deck; pool timing added to the pre-arrival email.", evidence: e(33), confidence: 0.85 },
    ],
    open_questions: [
      { id: "Q1", question: "Will the fire NOC certificate arrive before the bar licence, so both can open together in December?", raised_by: "dny", needs_answer_from: "client", evidence: e(11), confidence: 0.6 },
    ],
    next_meeting: { mentioned: true, date: "2026-11-18", raw_phrase: "Wednesday 18 November, same time", purpose: "Fortnightly review with the December festive plan.", evidence: e(58), confidence: 0.95 },
    client_sentiment: { label: "concerned", summary: "The owner is engaged but pointed about the missed flash report and the weak weekday numbers.", drivers: ["missed weekly flash report", "weekday occupancy behind budget", "approved the sous chef salary"], evidence: e(36), confidence: 0.85 },
    participants: [
      { speaker_label: "Priya Nair", name: "Priya Nair", side: "dny", role_guess: "DNY account manager", confidence: 0.95 },
      { speaker_label: "Arjun Mehta", name: "Arjun Mehta", side: "dny", role_guess: "DNY operations", confidence: 0.95 },
      { speaker_label: "Vikram Desai", name: "Vikram Desai", side: "client", role_guess: "owner", confidence: 0.95 },
      { speaker_label: "Neha Kulkarni", name: "Neha Kulkarni", side: "client", role_guess: "resident manager", confidence: 0.9 },
    ],
    quality: { transcript_quality: "good", speaker_labels_reliable: true, issues: [], unresolved_references: [] },
    overall_confidence: 0.9,
  };
}

/** Move every calendar date in a sheet by a number of days (keeps weekday phrases consistent). */
function shiftDates(sheet: Sheet, days: number): Sheet {
  const shift = (ymd: string | null) => {
    if (!ymd) return ymd;
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };
  return {
    ...sheet,
    action_items: sheet.action_items.map((a) => ({ ...a, due: { ...a.due, date: shift(a.due.date) } })),
    next_meeting: { ...sheet.next_meeting, date: shift(sheet.next_meeting.date) },
    key_facts: sheet.key_facts.map((f) => (f.category === "date" ? { ...f, normalized_value: f.normalized_value ? shift(f.normalized_value) ?? f.normalized_value : null } : f)),
  };
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
/** 10:30 IST on a calendar date. */
const istMorning = (ymd: string) => new Date(`${ymd}T05:00:00Z`).toISOString();

type MeetingSeed = {
  tldv: string;
  title: string;
  happened_at: string;
  duration_sec: number;
  type: Database["public"]["Enums"]["meeting_type"];
  type_source: Database["public"]["Enums"]["type_source"] | null;
  type_confidence: number | null;
  type_reason: string | null;
  client: string | null;
  client_name_guess?: string | null;
  transcript_ready: boolean;
  process_status: Database["public"]["Enums"]["process_status"];
  process_attempts: number;
  claimed_at?: string | null;
  failure_reason?: string | null;
  participants: { email: string; name: string; is_dny: boolean; is_organizer?: boolean }[];
  transcript?: { turns: SpeakerTurn[]; reliable: boolean };
};

const dny = (email: string, name: string, organizer = false) => ({ email, name, is_dny: true, is_organizer: organizer });
const ext = (c: { email: string; name: string }) => ({ ...c, is_dny: false });
const [priya, arjun, meera, karan] = PEOPLE;

const blueBayTurns = turnsFrom(BLUE_BAY_LINES, 10, 25);
const poorAudioTurns = turnsFrom(POOR_AUDIO_LINES, 9, 15);

async function loadExample() {
  const dir = path.join(process.cwd(), "agent");
  const sheet = SheetSchema.parse(JSON.parse(await readFile(path.join(dir, "example-sheet.json"), "utf8")));
  const turns = JSON.parse(await readFile(path.join(dir, "example-transcript.json"), "utf8")) as SpeakerTurn[];
  return { sheet, turns };
}

function meetingSeeds(example: { sheet: Sheet; turns: SpeakerTurn[] }): MeetingSeed[] {
  const saffron = CLIENTS[0].name;
  const blueBay = CLIENTS[1].name;
  const saffronPeople = [dny(priya.email, priya.full_name, true), dny(arjun.email, arjun.full_name), ext(CONTACTS.rakesh), ext(CONTACTS.sunita)];
  const blueBayPeople = [dny(priya.email, priya.full_name, true), dny(arjun.email, arjun.full_name), ext(CONTACTS.vikram), ext(CONTACTS.neha)];
  return [
    { tldv: "seed-01-new", title: "Blue Bay | Weekly ops sync", happened_at: hoursAgo(1), duration_sec: 1860, type: "client", type_source: "rule", type_confidence: 0.95, type_reason: "vikram@bluebay-sample.invalid is a contact of Sample Blue Bay Resort", client: blueBay, transcript_ready: false, process_status: "new", process_attempts: 0, participants: blueBayPeople },
    { tldv: "seed-02-waiting", title: "Saffron Court | Banquet SOP walkthrough", happened_at: hoursAgo(3), duration_sec: 2700, type: "client", type_source: "rule", type_confidence: 0.95, type_reason: "saffroncourt-sample.invalid is a domain of Sample Saffron Court Hotel", client: saffron, transcript_ready: false, process_status: "waiting_transcript", process_attempts: 0, participants: [dny(arjun.email, arjun.full_name, true), ext(CONTACTS.sunita)] },
    { tldv: "seed-03-ready", title: "Blue Bay | Fortnightly operations review", happened_at: hoursAgo(26), duration_sec: 2520, type: "client", type_source: "rule", type_confidence: 0.95, type_reason: "vikram@bluebay-sample.invalid is a contact of Sample Blue Bay Resort", client: blueBay, transcript_ready: true, process_status: "ready", process_attempts: 0, participants: blueBayPeople, transcript: { turns: blueBayTurns, reliable: true } },
    { tldv: "seed-04-processing", title: "Saffron Court | Kitchen audit follow-up", happened_at: hoursAgo(30), duration_sec: 1800, type: "client", type_source: "rule", type_confidence: 0.95, type_reason: "saffroncourt-sample.invalid is a domain of Sample Saffron Court Hotel", client: saffron, transcript_ready: true, process_status: "processing", process_attempts: 1, claimed_at: hoursAgo(0.2), participants: saffronPeople, transcript: { turns: example.turns, reliable: true } },
    { tldv: "seed-05-needs-decision", title: "Property visit debrief", happened_at: hoursAgo(50), duration_sec: 1500, type: "client", type_source: "llm", type_confidence: 0.62, type_reason: "Internal debrief about a new property whose owner has signed an agreement; could be onboarding or a pre-sales visit.", client: null, client_name_guess: null, transcript_ready: true, process_status: "needs_decision", process_attempts: 1, participants: [dny(priya.email, priya.full_name, true), dny(karan.email, karan.full_name), dny(meera.email, meera.full_name)], transcript: { turns: poorAudioTurns, reliable: false } },
    { tldv: "seed-06-done-saffron", title: "Saffron Court | October review", happened_at: istMorning("2026-11-04"), duration_sec: 1800, type: "client", type_source: "rule", type_confidence: 0.95, type_reason: "saffroncourt-sample.invalid is a domain of Sample Saffron Court Hotel", client: saffron, transcript_ready: true, process_status: "done", process_attempts: 1, participants: saffronPeople, transcript: { turns: example.turns, reliable: true } },
    { tldv: "seed-07-done-bluebay", title: "Blue Bay | Operations review", happened_at: istMorning("2026-11-04"), duration_sec: 2520, type: "client", type_source: "rule", type_confidence: 0.95, type_reason: "vikram@bluebay-sample.invalid is a contact of Sample Blue Bay Resort", client: blueBay, transcript_ready: true, process_status: "done", process_attempts: 1, participants: blueBayPeople, transcript: { turns: blueBayTurns, reliable: true } },
    { tldv: "seed-08-done-saffron-prev", title: "Saffron Court | September review", happened_at: istMorning("2026-10-28"), duration_sec: 1800, type: "client", type_source: "human", type_confidence: 1, type_reason: "Marked as a client meeting by Meera Iyer", client: saffron, transcript_ready: true, process_status: "done", process_attempts: 2, participants: saffronPeople, transcript: { turns: example.turns, reliable: true } },
    { tldv: "seed-09-skipped-sales", title: "Intro call | Grand Meridian Hotel", happened_at: hoursAgo(70), duration_sec: 2100, type: "sales", type_source: "llm", type_confidence: 0.92, type_reason: "First conversation with a hotel owner about DNY's management services and fees; no existing engagement.", client: null, client_name_guess: "Grand Meridian Hotel", transcript_ready: true, process_status: "skipped", process_attempts: 1, participants: [dny(karan.email, karan.full_name, true), ext(CONTACTS.prospect)], transcript: { turns: blueBayTurns, reliable: true } },
    { tldv: "seed-10-failed", title: "Site call (bad line)", happened_at: hoursAgo(96), duration_sec: 1500, type: "client", type_source: "rule", type_confidence: 0.95, type_reason: "gm@saffroncourt-sample.invalid is a contact of Sample Saffron Court Hotel", client: saffron, transcript_ready: true, process_status: "failed", process_attempts: 3, failure_reason: "The routine gave up after 3 attempts: evidence quotes could not be matched to the transcript (speaker labels are generic and large parts are inaudible)", participants: [dny(arjun.email, arjun.full_name, true), ext(CONTACTS.sunita)], transcript: { turns: poorAudioTurns, reliable: false } },
  ];
}

// ---------------------------------------------------------------------------
// Insert / refresh
// ---------------------------------------------------------------------------

async function seed() {
  const example = await loadExample();

  const { data: people, error: peopleError } = await db.from("people").upsert(PEOPLE.map((p) => ({ ...p, active: true })), { onConflict: "email" }).select("id, email, full_name");
  fail("people", peopleError);
  const personId = new Map(people!.map((p) => [p.email, p.id]));

  const clientId = new Map<string, string>();
  for (const c of CLIENTS) {
    const { data: found, error } = await db.from("clients").select("id").eq("name", c.name).maybeSingle();
    fail("clients", error);
    if (found) {
      fail("clients", (await db.from("clients").update(c).eq("id", found.id)).error);
      clientId.set(c.name, found.id);
    } else {
      const { data, error: insertError } = await db.from("clients").insert(c).select("id").single();
      fail("clients", insertError);
      clientId.set(c.name, data!.id);
    }
  }

  const seeds = meetingSeeds(example);
  const { data: meetings, error: meetingsError } = await db
    .from("meetings")
    .upsert(
      seeds.map((m) => ({
        tldv_meeting_id: m.tldv,
        title: m.title,
        happened_at: m.happened_at,
        duration_sec: m.duration_sec,
        organizer_email: m.participants.find((p) => p.is_organizer)?.email ?? null,
        organizer_name: m.participants.find((p) => p.is_organizer)?.name ?? null,
        tldv_url: `https://app.tldv.io/meetings/${m.tldv}`,
        type: m.type,
        type_source: m.type_source,
        type_confidence: m.type_confidence,
        type_reason: m.type_reason,
        client_id: m.client ? clientId.get(m.client) ?? null : null,
        client_name_guess: m.client_name_guess ?? null,
        transcript_ready: m.transcript_ready,
        process_status: m.process_status,
        process_attempts: m.process_attempts,
        claimed_at: m.claimed_at ?? null,
        failure_reason: m.failure_reason ?? null,
        source: "seed",
      })),
      { onConflict: "tldv_meeting_id" },
    )
    .select("id, tldv_meeting_id");
  fail("meetings", meetingsError);
  const meetingId = new Map(meetings!.map((m) => [m.tldv_meeting_id, m.id]));
  const ids = [...meetingId.values()];

  const participantRows = seeds.flatMap((m) => m.participants.map((p) => ({ meeting_id: meetingId.get(m.tldv)!, email: p.email, name: p.name, is_dny: p.is_dny, is_organizer: p.is_organizer ?? false })));
  fail("participants", (await db.from("participants").upsert(participantRows, { onConflict: "meeting_id,email" })).error);

  const transcriptRows = seeds
    .filter((m) => m.transcript)
    .map((m) => ({
      meeting_id: meetingId.get(m.tldv)!,
      tldv_transcript_id: `${m.tldv}-transcript`,
      turns: m.transcript!.turns as unknown as Json,
      sentence_count: m.transcript!.turns.reduce((n, t) => n + Math.max(1, (t.text.match(/[.?!]/g) ?? []).length), 0),
      word_count: m.transcript!.turns.reduce((n, t) => n + t.text.split(/\s+/).length, 0),
      speaker_labels_reliable: m.transcript!.reliable,
    }));
  fail("transcripts", (await db.from("transcripts").upsert(transcriptRows, { onConflict: "meeting_id" })).error);
  // Meetings without a transcript (new, waiting) must not keep one from an earlier run.
  const withoutTranscript = seeds.filter((m) => !m.transcript).map((m) => meetingId.get(m.tldv)!);
  if (withoutTranscript.length) fail("transcripts cleanup", (await db.from("transcripts").delete().in("meeting_id", withoutTranscript)).error);

  // Sheets and action items for the done meetings. Everything a previous run (or an API test
  // against seed meetings) stored is dropped first, so the seed state is exactly what is below.
  fail("action_items cleanup", (await db.from("action_items").delete().in("meeting_id", ids)).error);
  fail("sheets cleanup", (await db.from("sheets").delete().in("meeting_id", ids)).error);
  fail("agent_runs cleanup", (await db.from("agent_runs").delete().in("meeting_id", ids)).error);
  fail("pipeline_events cleanup", (await db.from("pipeline_events").delete().in("meeting_id", ids)).error);
  const admin = personId.get(meera.email)!;

  const saffronSheet = example.sheet;
  const prevSheetV1 = shiftDates({ ...example.sheet, headline: "Saffron Court review: owner pushed back on late MIS; costing model discussed, not yet approved.", action_items: example.sheet.action_items.slice(0, 8) }, -7);
  const prevSheetV2 = shiftDates({ ...example.sheet, headline: "Saffron Court September review: the owner flagged late MIS and approved the F&B costing model in principle." }, -7);
  const bbSheet = blueBaySheet(blueBayTurns);

  await storeSheet(meetingId.get("seed-06-done-saffron")!, saffronSheet, example.turns, "2026-11-04", 1, { done: ["A3"], edited: [], lowConfidence: [] }, admin);
  await storeSheet(meetingId.get("seed-07-done-bluebay")!, bbSheet, blueBayTurns, "2026-11-04", 1, { done: ["A6", "A2"], edited: ["A1"], lowConfidence: ["A9"] }, admin);
  await storeSheet(meetingId.get("seed-08-done-saffron-prev")!, prevSheetV1, example.turns, "2026-10-28", 1, { done: [], edited: [], lowConfidence: [] }, admin, true);
  await storeSheet(meetingId.get("seed-08-done-saffron-prev")!, prevSheetV2, example.turns, "2026-10-28", 2, { done: ["A1", "A2", "A3", "A5"], edited: ["A7"], lowConfidence: ["A13"] }, admin);

  // Routine runs and events, so the meeting pages have a history to show.
  const runs: Database["public"]["Tables"]["agent_runs"]["Insert"][] = [
    { meeting_id: meetingId.get("seed-04-processing")!, kind: "claim", status: "ok", attempt: 1, summary: "Claimed by the routine" },
    { meeting_id: meetingId.get("seed-05-needs-decision")!, kind: "claim", status: "ok", attempt: 1, summary: "Claimed by the routine" },
    { meeting_id: meetingId.get("seed-05-needs-decision")!, kind: "classify", status: "ok", attempt: 1, summary: "client (0.62) -> needs_decision: Internal debrief about a new property whose owner has signed an agreement." },
    { meeting_id: meetingId.get("seed-06-done-saffron")!, kind: "claim", status: "ok", attempt: 1, summary: "Claimed by the routine" },
    { meeting_id: meetingId.get("seed-06-done-saffron")!, kind: "extract", status: "rejected", attempt: 1, summary: "Sheet rejected: 2 errors", errors: { errors: ["action_items[2] (A3).owner.name: \"Rakesh ji\" is not a participant and is not said in the transcript", "key_facts[5] (F6): a money fact needs a digit or a number word in its evidence quote"] } },
    { meeting_id: meetingId.get("seed-06-done-saffron")!, kind: "extract", status: "ok", attempt: 1, summary: "Sheet v1 saved: 10 for DNY, 3 for the client, 3 decisions" },
    { meeting_id: meetingId.get("seed-07-done-bluebay")!, kind: "claim", status: "ok", attempt: 1, summary: "Claimed by the routine" },
    { meeting_id: meetingId.get("seed-07-done-bluebay")!, kind: "extract", status: "ok", attempt: 1, summary: "Sheet v1 saved: 7 for DNY, 2 for the client, 2 decisions" },
    { meeting_id: meetingId.get("seed-08-done-saffron-prev")!, kind: "claim", status: "ok", attempt: 1, summary: "Claimed by the routine" },
    { meeting_id: meetingId.get("seed-08-done-saffron-prev")!, kind: "extract", status: "ok", attempt: 1, summary: "Sheet v1 saved: 6 for DNY, 2 for the client, 3 decisions" },
    { meeting_id: meetingId.get("seed-08-done-saffron-prev")!, kind: "claim", status: "ok", attempt: 2, summary: "Re-run requested by Meera Iyer" },
    { meeting_id: meetingId.get("seed-08-done-saffron-prev")!, kind: "extract", status: "ok", attempt: 2, summary: "Sheet v2 saved: 10 for DNY, 3 for the client, 3 decisions; 1 edited item kept" },
    { meeting_id: meetingId.get("seed-09-skipped-sales")!, kind: "claim", status: "ok", attempt: 1, summary: "Claimed by the routine" },
    { meeting_id: meetingId.get("seed-09-skipped-sales")!, kind: "classify", status: "ok", attempt: 1, summary: "sales (0.92) -> skipped: First conversation with a hotel owner about DNY's management services and fees." },
    { meeting_id: meetingId.get("seed-10-failed")!, kind: "claim", status: "ok", attempt: 3, summary: "Claimed by the routine" },
    { meeting_id: meetingId.get("seed-10-failed")!, kind: "extract", status: "rejected", attempt: 3, summary: "Sheet rejected: 4 errors", errors: { errors: ["action_items[0] (A1).evidence[0]: timestamp \"around 5 minutes\" is not a transcript marker", "action_items[1] (A2).owner.name: \"the owner\" is not a participant and is not said in the transcript"] } },
    { meeting_id: meetingId.get("seed-10-failed")!, kind: "fail", status: "ok", attempt: 3, summary: "evidence quotes could not be matched to the transcript" },
  ];
  fail("agent_runs", (await db.from("agent_runs").insert(runs)).error);

  const events: Database["public"]["Tables"]["pipeline_events"]["Insert"][] = [
    { meeting_id: meetingId.get("seed-01-new")!, level: "info", step: "webhook", message: "MeetingReady received from tl;dv" },
    { meeting_id: meetingId.get("seed-02-waiting")!, level: "warn", step: "transcript", message: "tl;dv has not finished the transcript yet; retrying in 10 min (attempt 3)" },
    { meeting_id: meetingId.get("seed-03-ready")!, level: "info", step: "classify", message: "Rule B: client meeting (contact of Sample Blue Bay Resort)" },
    { meeting_id: meetingId.get("seed-06-done-saffron")!, level: "info", step: "extract", message: "Sheet v1 saved: 10 for DNY, 3 for the client, 3 decisions" },
    { meeting_id: meetingId.get("seed-09-skipped-sales")!, level: "info", step: "classify", message: "Routine classified the meeting as sales (92%) -> skipped" },
    { meeting_id: meetingId.get("seed-10-failed")!, level: "error", step: "agent", message: "Routine gave up after 3 attempts" },
  ];
  fail("pipeline_events", (await db.from("pipeline_events").insert(events)).error);

  console.log(`Seeded ${PEOPLE.length} people, ${CLIENTS.length} clients, ${seeds.length} meetings, ${transcriptRows.length} transcripts, 4 sheets, ${runs.length} routine runs, ${events.length} events.`);
}

/** Store one sheet version with its items the way save.ts would, with some rows done, edited or low-confidence. */
async function storeSheet(
  meetingId: string,
  sheet: Sheet,
  turns: SpeakerTurn[],
  meetingDateIst: string,
  version: number,
  marks: { done: string[]; edited: string[]; lowConfidence: string[] },
  adminId: string,
  superseded = false,
) {
  const participantNames = ["Priya Nair", "Arjun Mehta", "Meera Iyer", "Karan Shah", "Rakesh Agarwal", "Sunita Rao", "Vikram Desai", "Neha Kulkarni"];
  // The same two gates the API applies: the schema, then the transcript checks.
  const parsed = SheetSchema.safeParse(sheet);
  if (!parsed.success) {
    console.error(`Seed sheet v${version} for ${meetingId} fails the schema:\n${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n")}`);
    process.exit(1);
  }
  const check = checkSheet(sheet, { turns, durationSec: Math.max(...turns.map((t) => t.endSec)) + 60, meetingDateIst, participantNames, speakerLabels: [...new Set(turns.map((t) => t.speaker))] });
  if (check.errors.length) {
    console.error(`Seed sheet v${version} for ${meetingId} does not pass the checks:\n${check.errors.join("\n")}`);
    process.exit(1);
  }
  const verification = { prompt_version: PROMPT_VERSION, checked_at: new Date().toISOString(), warnings: check.warnings, evidence_verified: check.evidenceVerified, adjusted_confidence: check.adjustedConfidence };
  const { data: row, error } = await db
    .from("sheets")
    .upsert({ meeting_id: meetingId, version, status: superseded ? "superseded" : "ready", headline: sheet.headline, result: { ...sheet, verification } as unknown as Json, model: "claude-opus-5-5", prompt_version: PROMPT_VERSION }, { onConflict: "meeting_id,version" })
    .select("id")
    .single();
  fail("sheets", error);

  const secondsOf = (marker: string) => {
    const parts = marker.split(":").map(Number);
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  };
  const emailOf = (name: string | null) => {
    if (!name) return null;
    const person = PEOPLE.find((p) => p.full_name === name);
    if (person) return person.email;
    return Object.values(CONTACTS).find((c) => c.name === name)?.email ?? null;
  };
  const now = new Date().toISOString();
  const rows = sheet.action_items.map((item, i) => {
    const ev = item.evidence[0];
    const done = marks.done.includes(item.id);
    const edited = marks.edited.includes(item.id);
    const low = marks.lowConfidence.includes(item.id);
    return {
      meeting_id: meetingId,
      sheet_id: row!.id,
      item_key: itemKey(item.owed_by, item.title),
      position: i,
      title: edited ? `${item.title} (owner confirmed)` : item.title,
      details: item.details,
      owed_by: item.owed_by,
      owner_name: item.owner.name,
      owner_email: emailOf(item.owner.name),
      owner_basis: item.owner.basis,
      due_date: item.due.date,
      due_kind: item.due.kind,
      due_phrase: item.due.raw_phrase,
      priority: item.priority,
      status: superseded ? ("superseded" as const) : done ? ("done" as const) : ("open" as const),
      evidence_ts_sec: secondsOf(ev.timestamp),
      evidence_speaker: ev.speaker,
      evidence_quote: ev.quote,
      evidence_verified: low ? false : (check.evidenceDetails[item.id]?.[0] ?? false),
      confidence: low ? 0.42 : (check.adjustedConfidence[item.id] ?? item.confidence),
      linked_decision: item.linked_decision_id,
      edited_by: edited ? adminId : null,
      edited_at: edited ? now : null,
      done_at: done && !superseded ? now : null,
      done_by: done && !superseded ? adminId : null,
    };
  });
  fail("action_items", (await db.from("action_items").upsert(rows, { onConflict: "meeting_id,item_key" })).error);
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

async function remove() {
  const { data: meetings, error } = await db.from("meetings").select("id").eq("source", "seed");
  fail("meetings", error);
  const ids = (meetings ?? []).map((m) => m.id);
  if (ids.length) {
    fail("pipeline_events", (await db.from("pipeline_events").delete().in("meeting_id", ids)).error);
    // Cascades: participants, transcripts, sheets, action_items, agent_runs, feedback.
    fail("meetings", (await db.from("meetings").delete().in("id", ids)).error);
  }
  fail("people", (await db.from("people").delete().like("email", "%@sample.invalid")).error);
  fail("clients", (await db.from("clients").delete().like("name", "Sample %")).error);
  console.log(`Removed ${ids.length} seed meetings (with their participants, transcripts, sheets, items and runs), the sample people and the sample clients.`);
}

if (process.argv.includes("--remove")) await remove();
else await seed();
