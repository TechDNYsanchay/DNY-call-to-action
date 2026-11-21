// Which Callyzer rows become candidate calls. Pure. Only candidates are stored (call_log); every other
// row is only counted, so the status line can say where each of today's calls went. Nothing is gated
// per number (D2): a connected call of 45 s to 90 min on a line that is on, with someone outside DNY,
// is a candidate, and the routine decides later whether it is a work call.

import type { CallyzerRow } from "@/lib/callyzer/parse";
import { istDate } from "@/lib/format";
import { maskCounterpart, nameWithoutNumber, toE164Strict } from "@/lib/phone";
import { tokenSetRatio } from "@/lib/sheet/text";
import type { CallVerdict, ClassifiedRow, LedgerRow, LineState, PersonLite, TodayStats } from "./types";

export interface RulesContext {
  /** Registered lines by number (on and off). */
  lines: Map<string, LineState>;
  /** Other DNY numbers from the calls_dny_numbers setting, E.164. */
  dnyNumbers: Set<string>;
  /** Every DNY line number in this batch, registered or not (a call between two lines shows on both). */
  batchLines: Set<string>;
  minDurationSec: number;
  maxDurationSec: number;
}

/** The E.164 numbers of the DNY lines that made the calls in a batch. */
export function batchLinesOf(rows: CallyzerRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    const phone = toE164Strict("91", row.employeeNumber);
    if (phone) out.add(phone);
  }
  return out;
}

/**
 * The saved contact name, without any phone number in it: a contact saved as "+91 98201 23456" (or a
 * phone that reports the number as the name) has no name, so a full number never reaches a title, a
 * screen or the routine's package.
 */
export function contactName(raw: string | null): string | null {
  return nameWithoutNumber(raw);
}

export function buildLedgerRow(row: CallyzerRow, lineId: string): LedgerRow {
  return {
    callyzer_id: row.uniqueId,
    line_id: lineId,
    direction: row.callType.trim().toLowerCase() === "incoming" ? "incoming" : "outgoing",
    call_started_at: row.startedAt,
    duration_sec: row.durationSec,
    counterpart_e164: toE164Strict(row.countryCode, row.clientNumber),
    counterpart_masked: maskCounterpart(row.countryCode, row.clientNumber),
    counterpart_name: contactName(row.clientName),
    // Kept as given (https only); the host is checked at download, so a new media host fails visibly.
    recording_url: row.recordingUrl,
  };
}

/**
 * The checks, in order: connected, a valid line number, the line registered and on, started after the
 * line's switch-on, at least the minimum length, at most the maximum, and the other party not a DNY
 * number. Hidden or invalid numbers of the other party stay candidates.
 */
export function classifyCallRow(row: CallyzerRow, ctx: RulesContext): CallVerdict {
  const linePhone = toE164Strict("91", row.employeeNumber);
  const line = linePhone ? (ctx.lines.get(linePhone) ?? null) : null;
  const lineId = line?.id ?? null;
  const lineOn = !!line?.enabled;
  const verdict = (outcome: CallVerdict["outcome"]): CallVerdict => ({ outcome, lineId, lineOn });

  const type = row.callType.trim().toLowerCase();
  if (type !== "incoming" && type !== "outgoing") return verdict("not_connected");
  if (!linePhone) return verdict("invalid_line");
  if (!line || !lineOn) return verdict("line_off");
  if (!line.analyseFrom || Date.parse(row.startedAt) < Date.parse(line.analyseFrom)) return verdict("before_line_on");
  if (row.durationSec < ctx.minDurationSec) return verdict("short");
  if (row.durationSec > ctx.maxDurationSec) return verdict("too_long");
  const other = toE164Strict(row.countryCode, row.clientNumber);
  if (other && (ctx.lines.has(other) || ctx.batchLines.has(other) || ctx.dnyNumbers.has(other))) return verdict("internal");
  return { outcome: "candidate", lineId, lineOn, ledger: buildLedgerRow(row, line.id) };
}

/** Every row of a poll, once per Callyzer id (the first one wins), with the facts today's counts need. */
export function classifyCallRows(rows: CallyzerRow[], ctx: RulesContext): ClassifiedRow[] {
  const seen = new Set<string>();
  const out: ClassifiedRow[] = [];
  for (const row of rows) {
    if (seen.has(row.uniqueId)) continue;
    seen.add(row.uniqueId);
    out.push({ ...classifyCallRow(row, ctx), callyzerId: row.uniqueId, startedAt: row.startedAt, withLink: row.recordingUrl !== null });
  }
  return out;
}

/**
 * Today's (IST) rows on lines that are on, by outcome. Every run reads all of today, so these counts
 * replace the previous run's; they are never added up. onLines = short + tooLong + internal + beforeOn
 * + candidates, where short includes calls that never connected.
 */
export function todayStats(results: ClassifiedRow[], todayIst: string): TodayStats {
  const stats: TodayStats = { day: todayIst, onLines: 0, candidates: 0, short: 0, tooLong: 0, internal: 0, beforeOn: 0, lines: {} };
  const seen = new Set<string>();
  for (const r of results) {
    if (!r.lineOn || !r.lineId || seen.has(r.callyzerId) || istDate(r.startedAt) !== todayIst) continue;
    seen.add(r.callyzerId);
    const line = (stats.lines[r.lineId] ??= { calls: 0, candidates: 0, withLink: 0 });
    stats.onLines++;
    line.calls++;
    if (r.outcome === "candidate") {
      stats.candidates++;
      line.candidates++;
      if (r.withLink) line.withLink++;
    } else if (r.outcome === "short" || r.outcome === "not_connected") stats.short++;
    else if (r.outcome === "too_long") stats.tooLong++;
    else if (r.outcome === "internal") stats.internal++;
    // invalid_line and line_off never come with a line that is on, so this is before_line_on.
    else stats.beforeOn++;
  }
  return stats;
}

/**
 * The one active person whose name matches a line's Callyzer name (token-set ratio >= 0.8): a line
 * named after its user gets that person as its member. Null when nobody or more than one matches.
 */
export function soleMatchingPerson(name: string, people: PersonLite[]): PersonLite | null {
  const matches = people.filter((p) => p.active !== false && tokenSetRatio(name, p.full_name) >= 0.8);
  return matches.length === 1 ? matches[0] : null;
}
