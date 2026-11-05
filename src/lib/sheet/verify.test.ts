import { describe, expect, it } from "vitest";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import type { ActionItem, Evidence, KeyFact, Sheet } from "./schema";
import { type CheckContext, checkEvidence, checkSheet, daysBetween, turnsAround, weekdayIn, weekdayOf } from "./verify";
import { normaliseText } from "./text";
import { istDate } from "@/lib/format";

// Meeting on Wednesday 4 November 2026 (IST), 30 minutes.
const turns: SpeakerTurn[] = [
  { speaker: "Priya Nair", startSec: 30, endSec: 40, text: "Good morning everyone, thank you for joining." },
  { speaker: "Arjun Mehta", startSec: 114, endSec: 130, text: "October occupancy closed at 72 percent against 65 in September." },
  { speaker: "Rakesh Agarwal", startSec: 526, endSec: 540, text: "Main is hafte approve kar deta hoon, Friday tak confirm kar dunga." },
  { speaker: "Arjun Mehta", startSec: 882, endSec: 900, text: "The F&B payroll alone is running at saade paanch lakh per month." },
  { speaker: "Rakesh Agarwal", startSec: 1635, endSec: 1650, text: "Agar 5 tareekh tak nahi aaya toh main escalate karunga." },
];
const ctx: CheckContext = {
  turns,
  durationSec: 1800,
  meetingDateIst: "2026-11-04",
  participantNames: ["Priya Nair", "Arjun Mehta", "Rakesh Agarwal", "Sunita Rao"],
  speakerLabels: ["Priya Nair", "Arjun Mehta", "Rakesh Agarwal"],
};
const fullText = normaliseText(turns.map((t) => t.text).join(" "));

const ev = (timestamp: string, speaker: string, quote: string): Evidence => ({ timestamp, speaker, quote, quote_english: null });

const action = (over: Partial<ActionItem> = {}): ActionItem => ({
  id: "A1",
  title: "Approve the kitchen exhaust quote",
  details: "",
  owed_by: "client",
  owner: { name: "Rakesh Agarwal", side: "client", basis: "volunteered" },
  due: { kind: "relative_phrase", date: "2026-11-06", raw_phrase: "Friday tak", basis: "Wed 4 Nov; Friday = 6 Nov" },
  priority: "medium",
  linked_decision_id: null,
  evidence: [ev("8:46", "Rakesh Agarwal", "Main is hafte approve kar deta hoon, Friday tak confirm kar dunga.")],
  confidence: 0.9,
  ...over,
});

const fact = (over: Partial<KeyFact> = {}): KeyFact => ({
  id: "F1",
  fact: "F&B payroll is 5.5 lakh a month.",
  category: "money",
  normalized_value: "INR 550000",
  evidence: [ev("14:42", "Arjun Mehta", "The F&B payroll alone is running at saade paanch lakh per month.")],
  confidence: 0.9,
  ...over,
});

const sheet = (over: Partial<Sheet> = {}): Sheet => ({
  headline: "The owner approved the costing model and demanded the MIS on time.",
  executive_summary: ["One.", "Two.", "Three."],
  meeting_purpose: "review",
  language_profile: { primary: "hinglish", mixed: true, notes: null },
  action_items: [action()],
  decisions: [],
  key_facts: [fact()],
  risks: [],
  open_questions: [],
  next_meeting: { mentioned: false, date: null, raw_phrase: null, purpose: null, evidence: [], confidence: 0.5 },
  client_sentiment: { label: "mixed", summary: "Frustrated about MIS, happy with the chef.", drivers: [], evidence: [], confidence: 0.8 },
  participants: [],
  quality: { transcript_quality: "good", speaker_labels_reliable: true, issues: [], unresolved_references: [] },
  overall_confidence: 0.85,
  ...over,
});

describe("date helpers", () => {
  it("knows weekdays in English, Hinglish and Devanagari", () => {
    expect(weekdayIn("by Friday")).toBe(5);
    expect(weekdayIn("Somvar tak bhej do")).toBe(1);
    expect(weekdayIn("अगले शुक्रवार")).toBe(5);
    expect(weekdayIn("next week")).toBeNull();
  });
  it("computes day differences and weekdays on calendar dates", () => {
    expect(daysBetween("2026-11-04", "2026-11-06")).toBe(2);
    expect(daysBetween("2026-11-04", "2026-11-03")).toBe(-1);
    expect(weekdayOf("2026-11-06")).toBe(5);
    expect(weekdayOf("2026-11-04")).toBe(3);
  });
});

describe("checkEvidence", () => {
  it("accepts an exact quote anywhere, ignoring case and punctuation", () => {
    expect(checkEvidence(ev("8:46", "Rakesh Agarwal", "friday tak confirm kar dunga"), ctx, fullText).ok).toBe(true);
  });
  it("accepts a near quote by token overlap at the timestamp", () => {
    expect(checkEvidence(ev("1:54", "Arjun Mehta", "October occupancy closed at 72 percent, up from 65 in Sept"), ctx, fullText).ok).toBe(true);
  });
  it("warns, not fails, on a paraphrase", () => {
    const r = checkEvidence(ev("1:54", "Arjun Mehta", "the hotel did much better this month than last month"), ctx, fullText);
    expect(r).toMatchObject({ ok: false, fatal: false });
  });
  it("fails on unparseable or out-of-range timestamps", () => {
    expect(checkEvidence(ev("at 8 minutes", "x", "anything"), ctx, fullText).fatal).toBe(true);
    expect(checkEvidence(ev("45:00", "x", "anything"), ctx, fullText).fatal).toBe(true);
    expect(checkEvidence(ev("30:20", "Rakesh Agarwal", "main escalate karunga"), ctx, fullText).fatal).toBe(false);
  });
  it("finds the turn at a timestamp and its neighbours", () => {
    expect(turnsAround(turns, 530).map((t) => t.startSec)).toEqual([114, 526, 882]);
    expect(turnsAround(turns, 0).map((t) => t.startSec)).toEqual([30, 114]);
    expect(turnsAround([], 10)).toEqual([]);
  });
});

describe("checkSheet", () => {
  it("passes a grounded sheet with no errors", () => {
    const r = checkSheet(sheet(), ctx);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.evidenceVerified.A1).toBe(true);
    expect(r.adjustedConfidence.A1).toBe(0.9);
  });

  it("lowers confidence by 0.7 when a quote is not found", () => {
    const r = checkSheet(sheet({ action_items: [action({ evidence: [ev("8:46", "Rakesh Agarwal", "I will think about the quote next month maybe")] })] }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.includes("not found"))).toBe(true);
    expect(r.evidenceVerified.A1).toBe(false);
    expect(r.adjustedConfidence.A1).toBe(0.63);
  });

  it("flags review-tray items: unverified evidence and confidence under 0.5", () => {
    const r = checkSheet(sheet({ action_items: [action({ confidence: 0.4, evidence: [ev("8:46", "Rakesh Agarwal", "something that was never said here")] })] }), ctx);
    expect(r.warnings.some((w) => w.includes("review tray"))).toBe(true);
  });

  it("rejects an owner who is neither a participant nor named in the transcript", () => {
    const r = checkSheet(sheet({ action_items: [action({ owner: { name: "Vikram Singh", side: "client", basis: "explicitly_assigned" } })] }), ctx);
    expect(r.errors.some((e) => e.includes('owner.name: "Vikram Singh"') && e.includes("not_stated"))).toBe(true);
    // A participant with a slightly different spelling passes.
    expect(checkSheet(sheet({ action_items: [action({ owner: { name: "Rakesh ji", side: "client", basis: "volunteered" } })] }), ctx).errors).toEqual([]);
  });

  it("enforces the due-date window", () => {
    expect(checkSheet(sheet({ action_items: [action({ due: { kind: "explicit_date", date: "2026-10-20", raw_phrase: null, basis: null } })] }), ctx).errors[0]).toContain("days before the meeting");
    expect(checkSheet(sheet({ action_items: [action({ due: { kind: "explicit_date", date: "2028-01-01", raw_phrase: null, basis: null } })] }), ctx).errors[0]).toContain("days after the meeting");
    expect(checkSheet(sheet({ action_items: [action({ due: { kind: "explicit_date", date: "2026-11-03", raw_phrase: null, basis: null } })] }), ctx).errors).toEqual([]);
    expect(checkSheet(sheet({ action_items: [action({ due: { kind: "explicit_date", date: "2026-02-30", raw_phrase: null, basis: null } })] }), ctx).errors[0]).toContain("not a real calendar date");
  });

  it("checks weekday phrases against the IST meeting date", () => {
    // "by Friday" from Wednesday 4 Nov must be Friday 6 Nov: not the Friday after, not Thursday.
    expect(checkSheet(sheet({ action_items: [action({ due: { kind: "relative_phrase", date: "2026-11-13", raw_phrase: "by Friday", basis: null } })] }), ctx).errors[0]).toContain("names a friday");
    expect(checkSheet(sheet({ action_items: [action({ due: { kind: "relative_phrase", date: "2026-11-05", raw_phrase: "by Friday", basis: null } })] }), ctx).errors[0]).toContain("is a thursday");
    expect(checkSheet(sheet({ action_items: [action({ due: { kind: "relative_phrase", date: "2026-11-09", raw_phrase: "Somvar tak", basis: null } })] }), ctx).errors).toEqual([]);
    // A meeting at 23:30 UTC on Tuesday 3 Nov is already Wednesday 4 Nov in IST; the caller passes the IST date.
    expect(istDate("2026-11-03T23:30:00Z")).toBe("2026-11-04");
    // A meeting on a Friday saying "by Friday" may mean that day or the next one; both are within 8 days.
    const friday = { ...ctx, meetingDateIst: "2026-11-06" };
    expect(checkSheet(sheet({ action_items: [action({ due: { kind: "relative_phrase", date: "2026-11-13", raw_phrase: "by Friday", basis: null } })] }), friday).errors).toEqual([]);
    expect(checkSheet(sheet({ action_items: [action({ due: { kind: "relative_phrase", date: "2026-11-06", raw_phrase: "by Friday", basis: null } })] }), friday).errors).toEqual([]);
  });

  it("checks kind and date agree", () => {
    expect(checkSheet(sheet({ action_items: [action({ due: { kind: "none_stated", date: "2026-11-06", raw_phrase: null, basis: null } })] }), ctx).errors[0]).toContain("cannot carry a date");
    expect(checkSheet(sheet({ action_items: [action({ due: { kind: "explicit_date", date: null, raw_phrase: "the 10th", basis: null } })] }), ctx).errors[0]).toContain("needs a date");
  });

  it("requires a number in the evidence of money, quantity and metric facts, including Hindi words", () => {
    expect(checkSheet(sheet(), ctx).errors).toEqual([]);
    const noNumber = fact({ evidence: [ev("14:42", "Arjun Mehta", "The F&B payroll alone is running")] });
    expect(checkSheet(sheet({ key_facts: [noNumber] }), ctx).errors[0]).toContain("needs a digit or a number word");
    const devanagari = fact({ evidence: [{ timestamp: "14:42", speaker: "Arjun Mehta", quote: "ढाई लाख", quote_english: "two and a half lakh" }] });
    expect(checkSheet(sheet({ key_facts: [devanagari] }), ctx).errors).toEqual([]);
    const process = fact({ category: "process", evidence: [ev("14:42", "Arjun Mehta", "The F&B payroll alone is running")] });
    expect(checkSheet(sheet({ key_facts: [process] }), ctx).errors).toEqual([]);
  });

  it("rejects duplicate titles and duplicate ids", () => {
    const r = checkSheet(sheet({ action_items: [action(), action({ id: "A2", title: "Approve the kitchen exhaust quote!" })] }), ctx);
    expect(r.errors.some((e) => e.includes("duplicates A1"))).toBe(true);
    const ids = checkSheet(sheet({ action_items: [action(), action({ id: "A1", title: "Send the roster" })] }), ctx);
    expect(ids.errors.some((e) => e.includes("used twice"))).toBe(true);
  });

  it("requires exactly three summary bullets and valid decision links", () => {
    expect(checkSheet(sheet({ executive_summary: ["One.", "Two."] }), ctx).errors[0]).toContain("exactly 3 bullets");
    expect(checkSheet(sheet({ action_items: [action({ linked_decision_id: "D9" })] }), ctx).errors[0]).toContain("not a decision id");
  });

  it("checks the next meeting", () => {
    const nm = { mentioned: false, date: "2026-11-11", raw_phrase: null, purpose: null, evidence: [], confidence: 0.9 };
    const r = checkSheet(sheet({ next_meeting: nm }), ctx);
    expect(r.errors.some((e) => e.includes("mentioned is false"))).toBe(true);
    expect(checkSheet(sheet({ next_meeting: { ...nm, mentioned: true, date: "2026-10-01" } }), ctx).errors[0]).toContain("next_meeting.date");
  });

  it("warns about unknown speaker labels", () => {
    const r = checkSheet(sheet({ action_items: [action({ evidence: [ev("8:46", "Speaker 3", "Main is hafte approve kar deta hoon, Friday tak confirm kar dunga.")] })] }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.includes('speaker "Speaker 3"'))).toBe(true);
  });
});
