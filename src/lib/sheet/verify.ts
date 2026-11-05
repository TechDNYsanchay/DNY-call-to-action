// Checks a schema-valid sheet against the transcript it claims to describe. Pure, so the same
// function runs for ?dryRun=1 and for the real save. Errors block the save and tell the routine
// how to fix them; warnings are stored with the sheet and lower confidence where evidence is weak.

import { secondsFrom } from "@/lib/format";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import type { Evidence, Sheet } from "./schema";
import { hasNumber, normaliseText, tokenOverlap, tokenSetRatio, tokensOf } from "./text";

export interface CheckContext {
  turns: SpeakerTurn[];
  durationSec: number;
  /** The meeting's calendar date in IST, YYYY-MM-DD. */
  meetingDateIst: string;
  /** Canonical names: participants plus the DNY roster. */
  participantNames: string[];
  /** Distinct speaker labels in the transcript. */
  speakerLabels: string[];
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
  /** Per item id: at least one evidence entry was found in the transcript. */
  evidenceVerified: Record<string, boolean>;
  /** Per item id: the entry-by-entry result, in the order the sheet gave them. */
  evidenceDetails: Record<string, boolean[]>;
  /** Per item id: confidence after the evidence penalty, rounded to 2 decimals. */
  adjustedConfidence: Record<string, number>;
}

/** Unverified evidence costs this much confidence; the item is kept but shown as approximate. */
export const UNVERIFIED_PENALTY = 0.7;
/** Items below this with no verified evidence land in the review tray. */
export const REVIEW_TRAY_CONFIDENCE = 0.5;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// Hinglish / Hindi weekday names, Latin and Devanagari, mapped to the same index.
const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
  ravivar: 0, raviwar: 0, itwar: 0, somvar: 1, somwar: 1, mangalvar: 2, mangalwar: 2, budhvar: 3, budhwar: 3, guruvar: 4, guruwar: 4, brihaspativar: 4,
  shukravar: 5, shukrawar: 5, shanivar: 6, shaniwar: 6,
  "रविवार": 0, "इतवार": 0, "सोमवार": 1, "मंगलवार": 2, "बुधवार": 3, "गुरुवार": 4, "शुक्रवार": 5, "शनिवार": 6,
};

/** The weekday a phrase names (0 = Sunday), or null when it names none. */
export function weekdayIn(phrase: string): number | null {
  for (const t of tokensOf(phrase)) {
    const i = WEEKDAYS.indexOf(t);
    if (i >= 0) return i;
    if (t in WEEKDAY_ALIASES) return WEEKDAY_ALIASES[t];
  }
  return null;
}

const utcDay = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const daysBetween = (fromYmd: string, toYmd: string): number => Math.round((utcDay(toYmd) - utcDay(fromYmd)) / 86_400_000);
export const weekdayOf = (ymd: string): number => new Date(utcDay(ymd)).getUTCDay();
const isRealDate = (ymd: string): boolean => {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/** Turn at the timestamp and its neighbours, so a quote that spills over a turn boundary still counts. */
export function turnsAround(turns: SpeakerTurn[], sec: number): SpeakerTurn[] {
  if (!turns.length) return [];
  let index = turns.findIndex((t) => t.startSec <= sec && sec <= t.endSec);
  if (index < 0) {
    // Nearest start; the routine copies the marker from the line, so this is normally exact.
    let bestDist = Number.POSITIVE_INFINITY;
    turns.forEach((t, i) => {
      const d = Math.abs(t.startSec - sec);
      if (d < bestDist) {
        bestDist = d;
        index = i;
      }
    });
  }
  return turns.slice(Math.max(0, index - 1), Math.min(turns.length, index + 2));
}

export interface EvidenceCheck {
  ok: boolean;
  problem: string | null;
  /** Fatal problems (unparseable or out-of-range timestamp) stop the save; a missing quote only warns. */
  fatal: boolean;
}

export function checkEvidence(e: Evidence, ctx: CheckContext, fullText: string): EvidenceCheck {
  const sec = secondsFrom(e.timestamp);
  if (sec === null) return { ok: false, fatal: true, problem: `timestamp "${e.timestamp}" is not a transcript marker; copy it exactly as it appears, e.g. 12:34 or 1:02:10` };
  if (sec > ctx.durationSec + 30) return { ok: false, fatal: true, problem: `timestamp ${e.timestamp} is past the end of the recording (${Math.round(ctx.durationSec / 60)} min)` };
  const quote = normaliseText(e.quote);
  if (quote && fullText.includes(quote)) return { ok: true, fatal: false, problem: null };
  const nearby = turnsAround(ctx.turns, sec).map((t) => t.text).join(" ");
  if (tokenOverlap(e.quote, nearby) >= 0.6) return { ok: true, fatal: false, problem: null };
  return { ok: false, fatal: false, problem: `quote at ${e.timestamp} was not found in the transcript near that time; copy the words verbatim from that line` };
}

const nameIsSupported = (name: string, ctx: CheckContext, fullText: string): boolean => {
  if (ctx.participantNames.some((p) => tokenSetRatio(name, p) >= 0.8)) return true;
  const n = normaliseText(name);
  return n.length > 0 && fullText.includes(n);
};

export function checkSheet(sheet: Sheet, ctx: CheckContext): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const evidenceVerified: Record<string, boolean> = {};
  const evidenceDetails: Record<string, boolean[]> = {};
  const adjustedConfidence: Record<string, number> = {};
  const fullText = normaliseText(ctx.turns.map((t) => t.text).join(" "));
  const labelSet = new Set(ctx.speakerLabels.map(normaliseText));
  const seenIds = new Set<string>();

  const checkItem = (path: string, id: string, evidence: Evidence[], confidence: number) => {
    if (seenIds.has(id)) errors.push(`${path}: id "${id}" is used twice; ids must be unique across the sheet`);
    seenIds.add(id);
    const details = evidence.map((e, i) => {
      const r = checkEvidence(e, ctx, fullText);
      if (r.fatal) errors.push(`${path}.evidence[${i}]: ${r.problem}`);
      else if (!r.ok) warnings.push(`${path}.evidence[${i}]: ${r.problem}`);
      if (e.speaker && labelSet.size && !labelSet.has(normaliseText(e.speaker))) {
        warnings.push(`${path}.evidence[${i}]: speaker "${e.speaker}" is not a label in this transcript`);
      }
      return r.ok;
    });
    evidenceDetails[id] = details;
    evidenceVerified[id] = details.some(Boolean);
    const penalised = details.length > 0 && details.some((ok) => !ok);
    adjustedConfidence[id] = Math.round((penalised ? confidence * UNVERIFIED_PENALTY : confidence) * 100) / 100;
  };

  if (sheet.executive_summary.length !== 3) errors.push(`executive_summary: exactly 3 bullets are required, got ${sheet.executive_summary.length}`);

  const titles = new Map<string, string>();
  sheet.action_items.forEach((item, i) => {
    const path = `action_items[${i}] (${item.id})`;
    checkItem(path, item.id, item.evidence, item.confidence);

    const stem = tokensOf(item.title).join(" ");
    const dup = titles.get(stem);
    if (dup) errors.push(`${path}: title duplicates ${dup}; merge the two items or make them clearly different tasks`);
    else titles.set(stem, item.id);

    if (item.owner.name && !nameIsSupported(item.owner.name, ctx, fullText)) {
      errors.push(`${path}.owner.name: "${item.owner.name}" is not a participant and is not said in the transcript; use a name from the participants list, or set owner.name to null and owner.basis to "not_stated"`);
    }
    if (item.owner.name === null && item.owner.basis !== "not_stated" && item.owner.basis !== "implied_by_role") {
      warnings.push(`${path}.owner: basis "${item.owner.basis}" without a name; use "not_stated" when nobody was named`);
    }

    const due = item.due;
    if (due.date !== null) {
      if (!isRealDate(due.date)) {
        errors.push(`${path}.due.date: ${due.date} is not a real calendar date`);
      } else {
        const diff = daysBetween(ctx.meetingDateIst, due.date);
        if (diff < -1 || diff > 365) {
          errors.push(`${path}.due.date: ${due.date} is ${diff < 0 ? `${-diff} days before` : `${diff} days after`} the meeting (${ctx.meetingDateIst}); dates must fall between the day before the meeting and one year after, or be null`);
        } else if (due.raw_phrase) {
          const wd = weekdayIn(due.raw_phrase);
          if (wd !== null && (weekdayOf(due.date) !== wd || diff < 0 || diff > 8)) {
            errors.push(`${path}.due.date: "${due.raw_phrase}" names a ${WEEKDAYS[wd]}, so the date must be the ${WEEKDAYS[wd]} within 8 days after the meeting date ${ctx.meetingDateIst} (IST); ${due.date} is a ${WEEKDAYS[weekdayOf(due.date)]} ${diff} days later`);
          }
        }
      }
      if (due.kind === "none_stated") errors.push(`${path}.due: kind "none_stated" cannot carry a date; set kind to explicit_date or relative_phrase, or date to null`);
    } else if (due.kind === "explicit_date") {
      errors.push(`${path}.due: kind "explicit_date" needs a date; set the YYYY-MM-DD date or change kind to relative_phrase`);
    }

    if (!evidenceVerified[item.id] && item.confidence < REVIEW_TRAY_CONFIDENCE) {
      warnings.push(`${path}: no verified evidence and confidence ${item.confidence}; it will sit in the review tray`);
    }
  });

  sheet.decisions.forEach((d, i) => checkItem(`decisions[${i}] (${d.id})`, d.id, d.evidence, d.confidence));

  sheet.key_facts.forEach((f, i) => {
    const path = `key_facts[${i}] (${f.id})`;
    checkItem(path, f.id, f.evidence, f.confidence);
    if ((f.category === "money" || f.category === "quantity" || f.category === "metric") && !f.evidence.some((e) => hasNumber(e.quote) || (e.quote_english ? hasNumber(e.quote_english) : false))) {
      errors.push(`${path}: a ${f.category} fact needs a digit or a number word (English or Hindi) in its evidence quote; quote the line where the figure is said`);
    }
  });

  sheet.risks.forEach((r, i) => checkItem(`risks[${i}] (${r.id})`, r.id, r.evidence, r.confidence));
  sheet.open_questions.forEach((q, i) => checkItem(`open_questions[${i}] (${q.id})`, q.id, q.evidence, q.confidence));

  const nm = sheet.next_meeting;
  if (nm.evidence.length) checkItem("next_meeting", "next_meeting", nm.evidence, nm.confidence);
  if (nm.date !== null) {
    if (!isRealDate(nm.date)) errors.push(`next_meeting.date: ${nm.date} is not a real calendar date`);
    else {
      const diff = daysBetween(ctx.meetingDateIst, nm.date);
      if (diff < 0 || diff > 365) errors.push(`next_meeting.date: ${nm.date} must be after the meeting date ${ctx.meetingDateIst} and within a year, or null`);
    }
    if (!nm.mentioned) errors.push("next_meeting: a date is given but mentioned is false; set mentioned to true or date to null");
  }
  if (sheet.client_sentiment.evidence.length) checkItem("client_sentiment", "client_sentiment", sheet.client_sentiment.evidence, sheet.client_sentiment.confidence);

  // A linked decision must exist.
  const decisionIds = new Set(sheet.decisions.map((d) => d.id));
  sheet.action_items.forEach((item, i) => {
    if (item.linked_decision_id && !decisionIds.has(item.linked_decision_id)) {
      errors.push(`action_items[${i}] (${item.id}).linked_decision_id: "${item.linked_decision_id}" is not a decision id in this sheet; use an existing id or null`);
    }
  });

  return { errors, warnings, evidenceVerified, evidenceDetails, adjustedConfidence };
}
