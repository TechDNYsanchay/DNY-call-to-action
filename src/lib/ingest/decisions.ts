// The pure decisions behind intake: which columns a tl;dv meeting maps to, who may change a meeting's
// type or status, what happens to a meeting when its transcript lands, and when the cron should try
// (or stop trying) to fetch a transcript. No database here, so every branch is unit tested.

import type { Database } from "@/lib/supabase/database.types";
import { isDnyEmail, type TldvMeeting } from "@/lib/tldv/parse";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import type { RulesResult } from "./rules";

export type ProcessStatus = Database["public"]["Enums"]["process_status"];
export type MeetingType = Database["public"]["Enums"]["meeting_type"];
export type TypeSource = Database["public"]["Enums"]["type_source"];
export type MeetingSource = "webhook" | "poll" | "backfill" | "manual" | "seed";

/** What intake needs to know about the stored row before touching it. */
export interface MeetingState {
  type: MeetingType;
  type_source: TypeSource | null;
  process_status: ProcessStatus;
  transcript_ready: boolean;
}

/** Statuses where the routine or a person owns the meeting: intake must not change type or status. */
export const LOCKED_STATUSES: ReadonlySet<ProcessStatus> = new Set<ProcessStatus>(["processing", "done", "needs_decision", "failed"]);

/** Before the transcript: statuses the cron may still move. */
export const AWAITING_TRANSCRIPT: ReadonlySet<ProcessStatus> = new Set<ProcessStatus>(["new", "waiting_transcript"]);

/** A human label is final, and the routine's work is never undone by a re-sync. */
export function canChangeType(state: MeetingState): boolean {
  return state.type_source !== "human" && !LOCKED_STATUSES.has(state.process_status);
}

export interface TypeColumns {
  type: MeetingType;
  type_source: TypeSource;
  type_confidence: number;
  type_reason: string;
  client_id: string | null;
}

export function typeColumnsFrom(rules: RulesResult): TypeColumns {
  return { type: rules.type, type_source: "rule", type_confidence: rules.confidence, type_reason: rules.reason, client_id: rules.clientId };
}

/** The metadata columns of a meetings row, from a parsed tl;dv meeting. */
export function metadataColumns(meeting: TldvMeeting) {
  return {
    tldv_meeting_id: meeting.id,
    title: meeting.title,
    happened_at: meeting.happenedAt,
    duration_sec: meeting.durationSec,
    organizer_email: meeting.organizer.email,
    organizer_name: meeting.organizer.name,
    tldv_url: meeting.url ?? `https://app.tldv.io/meetings/${meeting.id}`,
    // Only when tl;dv sent one: a listing without it must not erase the code that ties a booking.
    ...(meeting.meetCode ? { meet_code: meeting.meetCode } : {}),
  };
}

export interface ParticipantRow {
  email: string;
  name: string | null;
  is_dny: boolean;
  is_organizer: boolean;
}

/** Invitees plus the organiser, one row per email (lower-cased), people without an email left out. */
export function participantRows(meeting: TldvMeeting): ParticipantRow[] {
  const rows = new Map<string, ParticipantRow>();
  const organizer = meeting.organizer.email?.toLowerCase() ?? null;
  for (const person of [meeting.organizer, ...meeting.invitees]) {
    const email = person.email?.toLowerCase().trim();
    if (!email || !email.includes("@")) continue;
    const existing = rows.get(email);
    rows.set(email, {
      email,
      name: existing?.name ?? person.name ?? null,
      is_dny: isDnyEmail(email),
      is_organizer: email === organizer,
    });
  }
  return [...rows.values()];
}

/**
 * Plan for a meeting seen without its transcript (webhook MeetingReady, poll, backfill). A new row
 * starts 'new', or 'skipped' straight away when a rule already says it is not a client meeting (too
 * short, or a sales meeting named "vision call"). An existing row only gets its type refreshed (a
 * client may have been added since), never its status, except that such a meeting still waiting for
 * a transcript is closed as skipped.
 */
export function planAfterUpsert(existing: MeetingState | null, rules: RulesResult): { typeColumns: TypeColumns | null; process_status: ProcessStatus | null } {
  const typeColumns = typeColumnsFrom(rules);
  const notOurs = rules.decided && rules.type !== "client";
  if (!existing) return { typeColumns, process_status: notOurs ? "skipped" : "new" };
  if (!canChangeType(existing)) return { typeColumns: null, process_status: null };
  if (notOurs && AWAITING_TRANSCRIPT.has(existing.process_status)) return { typeColumns, process_status: "skipped" };
  return { typeColumns, process_status: null };
}

/**
 * Plan for a meeting whose transcript has just been stored. The rules run again with the sentence
 * count; a decided non-client is 'skipped', everything else is 'ready' for the routine. A human label
 * keeps its type and only gains the status that follows from it.
 */
export function planAfterTranscript(state: MeetingState, rules: RulesResult): { typeColumns: TypeColumns | null; process_status: ProcessStatus | null } {
  if (LOCKED_STATUSES.has(state.process_status)) return { typeColumns: null, process_status: null };
  if (state.type_source === "human") return { typeColumns: null, process_status: state.type === "client" ? "ready" : "skipped" };
  const skip = rules.decided && rules.type !== "client";
  return { typeColumns: typeColumnsFrom(rules), process_status: skip ? "skipped" : "ready" };
}

/** 'new' becomes 'waiting_transcript'; anything else is left alone. */
export function statusAfterWaiting(state: MeetingState): ProcessStatus | null {
  return state.process_status === "new" ? "waiting_transcript" : null;
}

/** Minutes after a meeting ends before the cron first asks tl;dv for the transcript. */
export const TRANSCRIPT_GRACE_MIN = 10;
/** Hours after a meeting ends before the cron stops asking and skips the meeting. */
export const TRANSCRIPT_GIVE_UP_HOURS = 48;
export const NO_TRANSCRIPT_REASON = `No transcript from tl;dv after ${TRANSCRIPT_GIVE_UP_HOURS} hours`;

export interface TranscriptCandidate {
  happened_at: string;
  duration_sec: number;
  transcript_ready: boolean;
  process_status: ProcessStatus;
}

/** When the recording stopped, from the start time and the duration. */
export const endedAt = (m: { happened_at: string; duration_sec: number }): Date => new Date(new Date(m.happened_at).getTime() + m.duration_sec * 1000);

export type TranscriptDecision = "try" | "give_up" | "wait" | "none";

/** Whether the cron should fetch, give up on, or not yet bother with a meeting's transcript. */
export function transcriptDecision(m: TranscriptCandidate, now: Date): TranscriptDecision {
  if (m.transcript_ready || !AWAITING_TRANSCRIPT.has(m.process_status)) return "none";
  const ended = endedAt(m).getTime();
  if (ended > now.getTime() - TRANSCRIPT_GRACE_MIN * 60_000) return "wait";
  if (ended < now.getTime() - TRANSCRIPT_GIVE_UP_HOURS * 3_600_000) return "give_up";
  return "try";
}

/** Sentences in the stored turns (Latin punctuation and the Devanagari danda); at least one per turn. */
export function countSentences(turns: SpeakerTurn[]): number {
  return turns.reduce((n, t) => n + Math.max(1, (t.text.match(/[.!?।]+(\s|$)/g) ?? []).length), 0);
}

const normalise = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-zऀ-ॿ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const compact = s.replace(/\s/g, "");
  for (let i = 0; i < compact.length - 1; i++) {
    const g = compact.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice similarity on character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return a === b ? 1 : 0;
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  const total = [...ga.values()].reduce((x, y) => x + y, 0) + [...gb.values()].reduce((x, y) => x + y, 0);
  return (2 * shared) / total;
}

/** Levenshtein edit distance, for short name tokens only. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** "agarwal" ~ "agrawal", "nair" ~ "nayar": spelling variants of one name token, never of a short one. */
function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const shortest = Math.min(a.length, b.length);
  if (shortest < 4) return false;
  return editDistance(a, b) <= (shortest >= 6 ? 2 : 1);
}

/** Does a tl;dv speaker label ("Priya", "priya nair", "Rakesh Agrawal (Hotel Sunrise)") name this participant? */
export function nameMatches(label: string, name: string): boolean {
  const a = normalise(label);
  const b = normalise(name);
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split(" ");
  const tb = b.split(" ");
  // One side's tokens all appear in the other ("Priya" in "Priya Nair"), with a real token, not an initial.
  const subset = (x: string[], y: string[]) => x.every((t) => y.some((u) => tokenMatches(t, u))) && x.some((t) => t.length >= 3);
  if (subset(ta, tb) || subset(tb, ta)) return true;
  return similarity(a, b) >= 0.8;
}

/**
 * True when at least half of the distinct speaker labels map to a participant name, null when there is
 * nothing to compare. Below half, the routine is told owners may not be marked as explicitly assigned.
 */
export function speakerLabelsReliable(labels: string[], participantNames: Array<string | null>): boolean | null {
  const distinct = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  const names = participantNames.filter((n): n is string => !!n && n.trim().length > 0);
  if (distinct.length === 0) return null;
  if (names.length === 0) return false;
  const matched = distinct.filter((label) => names.some((name) => nameMatches(label, name))).length;
  return matched * 2 >= distinct.length;
}
