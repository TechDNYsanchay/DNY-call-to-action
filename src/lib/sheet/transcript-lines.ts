// Turns the stored speaker turns into the lines the routine reads: "[m:ss] Label (DNY): text".
// The raw tl;dv label is kept verbatim (the routine copies it into evidence); the side tag is
// appended only when the label fuzzy-matches a known participant or a DNY roster member. Pure.

import { formatTimestamp } from "@/lib/format";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import { bestMatch, detectLanguage, type LanguageProfile } from "./text";

export interface LineParticipant {
  name: string | null;
  email: string;
  /** Decided by the caller: DNY from the email domain, client from the client record, unknown otherwise. */
  side: "dny" | "client" | "unknown";
}

export interface RosterPerson {
  full_name: string;
  email: string;
  dept: string | null;
}

export type Side = "dny" | "client" | "unknown";

export interface SpeakerMapping {
  label: string;
  side: Side;
  /** Canonical name (participant or roster), null when the label did not map. */
  name: string | null;
  email: string | null;
  /** DNY department from the roster, null for clients and unmapped labels. */
  role: string | null;
}

export interface TranscriptLines {
  lines: string[];
  speakers: SpeakerMapping[];
  /** At least half of the distinct labels mapped to a known person. */
  speakerLabelsReliable: boolean;
  language: LanguageProfile;
}

/** Generic labels ("Speaker 1", "Unknown speaker") never map to a person, whatever the fuzzy score says. */
export const isGenericLabel = (label: string): boolean => /^(speaker|unknown|guest|participant|user)\b/i.test(label.trim()) || /^\d+$/.test(label.trim());

/** Resolve one speaker label to a participant or roster member. Participants win over the roster. */
export function mapSpeaker(label: string, participants: LineParticipant[], roster: RosterPerson[]): SpeakerMapping {
  if (!isGenericLabel(label)) {
    const p = bestMatch(label, participants, (c) => c.name);
    if (p) {
      const person = roster.find((r) => r.email === p.email) ?? null;
      return { label, side: p.side, name: p.name, email: p.email, role: p.side === "dny" ? person?.dept ?? null : null };
    }
    const r = bestMatch(label, roster, (c) => c.full_name);
    if (r) return { label, side: "dny", name: r.full_name, email: r.email, role: r.dept };
  }
  return { label, side: "unknown", name: null, email: null, role: null };
}

const tag = (side: Side) => (side === "dny" ? " (DNY)" : side === "client" ? " (Client)" : "");

export function buildTranscriptLines(turns: SpeakerTurn[], participants: LineParticipant[], roster: RosterPerson[]): TranscriptLines {
  const labels = [...new Set(turns.map((t) => t.speaker))];
  const speakers = labels.map((label) => mapSpeaker(label, participants, roster));
  const bySide = new Map(speakers.map((s) => [s.label, s.side]));
  const lines = turns.map((t) => `[${formatTimestamp(t.startSec)}] ${t.speaker}${tag(bySide.get(t.speaker) ?? "unknown")}: ${t.text}`);
  const mapped = speakers.filter((s) => s.name !== null).length;
  return {
    lines,
    speakers,
    speakerLabelsReliable: labels.length > 0 && mapped * 2 >= labels.length,
    language: detectLanguage(turns.map((t) => t.text).join("\n")),
  };
}
