// What a call's sheet adds to the meeting sheet on screen: who each machine speaker label is ("Speaker 1"
// -> "Ashwini (DNY)"), the refined second of every quote, and the one quiet line for the sections a short
// call leaves empty. Pure. Read straight from the stored JSON, so it works for any sheet version.

import type { Json } from "@/lib/supabase/database.types";
import type { OtherSide } from "./lanes";

export type ParticipantSide = "dny" | "client" | "third_party" | "unknown";

export interface SheetParticipant {
  speaker_label: string;
  name: string | null;
  side: ParticipantSide;
}

const SIDES = new Set<ParticipantSide>(["dny", "client", "third_party", "unknown"]);
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The sheet's participants[] (the routine's mapping of speaker labels), defensively. */
export function sheetParticipants(result: Json | null): SheetParticipant[] {
  const raw = asRecord(result).participants;
  if (!Array.isArray(raw)) return [];
  const out: SheetParticipant[] = [];
  for (const p of raw) {
    const r = asRecord(p);
    if (typeof r.speaker_label !== "string" || !r.speaker_label.trim()) continue;
    out.push({
      speaker_label: r.speaker_label,
      name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : null,
      side: SIDES.has(r.side as ParticipantSide) ? (r.side as ParticipantSide) : "unknown",
    });
  }
  return out;
}

/** verification.evidence_seconds: the second each quote is said, by entry id ("A1", "D2", "next_meeting"). */
export function refinedSeconds(result: Json | null): Record<string, number[]> {
  const raw = asRecord(asRecord(asRecord(result).verification).evidence_seconds);
  const out: Record<string, number[]> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue;
    const seconds = value.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);
    if (seconds.length) out[id] = seconds;
  }
  return out;
}

/** "Rakesh (client)", "Ashwini (DNY)", "Speaker 2 (vendor)" by speaker label; the other side named by `word`. */
export function speakerNamesOf(participants: SheetParticipant[], otherSide: OtherSide): Record<string, string> {
  const names: Record<string, string> = {};
  for (const p of participants) {
    const side = p.side === "dny" ? "DNY" : p.side === "client" ? otherSide.word : p.side === "third_party" ? "other party" : null;
    const who = p.name ?? p.speaker_label;
    names[p.speaker_label] = side ? `${who} (${side})` : who;
  }
  return names;
}

/** The side each speaker label is on, for the speaker strip and the transcript dots. */
export function speakerSidesOf(participants: SheetParticipant[]): Record<string, "dny" | "other"> {
  const sides: Record<string, "dny" | "other"> = {};
  for (const p of participants) {
    if (p.side === "dny") sides[p.speaker_label] = "dny";
    else if (p.side === "client" || p.side === "third_party") sides[p.speaker_label] = "other";
  }
  return sides;
}

/** "No decisions, risks or open questions on this call." for the sections a call left empty, in order. */
export function quietSectionsLine(empty: string[]): string | null {
  if (!empty.length) return null;
  const list = empty.length === 1 ? empty[0] : `${empty.slice(0, -1).join(", ")} or ${empty[empty.length - 1]}`;
  return `No ${list} on this call.`;
}
