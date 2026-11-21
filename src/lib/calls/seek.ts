// Where in the recording a quote is said. Pure, shared by the save (stored once per sheet) and the call
// page (a fallback for older sheets). A sheet's timestamp marker is the start of the turn the routine
// copied it from; a turn can run 25 s, so playing from the marker can start well before the words.
// This finds the quote in the transcript and interpolates inside its turn.

import { secondsFrom } from "@/lib/format";
import type { Evidence, Sheet } from "@/lib/sheet/schema";
import { normaliseText } from "@/lib/sheet/text";
import type { SpeakerTurn } from "./types";

/** Words of a quote used when the whole quote is not found (it may span a pause-split turn). */
const PREFIX_WORDS = 5;

interface QuoteIndex {
  /** The normalised turns joined by single spaces. */
  joined: string;
  /** Each turn's offset in `joined`, its normalised text and the turn itself, in order. */
  turns: Array<{ at: number; text: string; turn: SpeakerTurn }>;
}

function buildIndex(turns: SpeakerTurn[]): QuoteIndex {
  let at = 0;
  const entries = turns.map((turn) => {
    const text = normaliseText(turn.text);
    const entry = { at, text, turn };
    at += text.length + 1;
    return entry;
  });
  return { joined: entries.map((e) => e.text).join(" "), turns: entries };
}

/** Every position where `needle` starts and ends on a word boundary. */
function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let pos = haystack.indexOf(needle); pos >= 0; pos = haystack.indexOf(needle, pos + 1)) {
    const end = pos + needle.length;
    if ((pos === 0 || haystack[pos - 1] === " ") && (end === haystack.length || haystack[end] === " ")) out.push(pos);
  }
  return out;
}

function refineWith(index: QuoteIndex, markerSec: number, quote: string | null): number {
  const q = quote ? normaliseText(quote) : "";
  if (!q || !index.turns.length) return markerSec;
  let hits = occurrences(index.joined, q);
  if (!hits.length) hits = occurrences(index.joined, q.split(" ").slice(0, PREFIX_WORDS).join(" "));
  if (!hits.length) return markerSec;
  let best: { entry: QuoteIndex["turns"][number]; pos: number; distance: number } | null = null;
  for (const pos of hits) {
    // The turn the hit starts in: the last one starting at or before it.
    let entry = index.turns[0];
    for (const e of index.turns) {
      if (e.at > pos) break;
      entry = e;
    }
    const distance = Math.abs(entry.turn.startSec - markerSec);
    // Hits come in order, so a strict comparison keeps the earlier one on a tie.
    if (!best || distance < best.distance) best = { entry, pos, distance };
  }
  const { entry, pos } = best!;
  const share = entry.text.length ? (pos - entry.at) / entry.text.length : 0;
  return Math.round((entry.turn.startSec + share * (entry.turn.endSec - entry.turn.startSec)) * 100) / 100;
}

/**
 * The second a quote is said: the occurrence (the full quote, else its first five words) whose turn
 * starts nearest the marker, interpolated inside that turn. The marker itself when the quote is empty or
 * not found. Playback starts a second earlier.
 */
export function refineQuoteSecond(markerSec: number, quote: string | null, turns: SpeakerTurn[]): number {
  return refineWith(buildIndex(turns), markerSec, quote);
}

/**
 * The refined second of every evidence entry in a sheet, by entry id ("A1", "D2", "F1", "R1", "Q1",
 * "next_meeting", "client_sentiment"), in the order the sheet gives them.
 */
export function refineEvidenceSeconds(sheet: Sheet, turns: SpeakerTurn[]): Record<string, number[]> {
  const index = buildIndex(turns);
  const entries: Array<[string, Evidence[]]> = [
    ...sheet.action_items.map((i): [string, Evidence[]] => [i.id, i.evidence]),
    ...sheet.decisions.map((d): [string, Evidence[]] => [d.id, d.evidence]),
    ...sheet.key_facts.map((f): [string, Evidence[]] => [f.id, f.evidence]),
    ...sheet.risks.map((r): [string, Evidence[]] => [r.id, r.evidence]),
    ...sheet.open_questions.map((q): [string, Evidence[]] => [q.id, q.evidence]),
    ["next_meeting", sheet.next_meeting.evidence],
    ["client_sentiment", sheet.client_sentiment.evidence],
  ];
  const out: Record<string, number[]> = {};
  for (const [id, evidence] of entries) out[id] = evidence.map((e) => refineWith(index, secondsFrom(e.timestamp) ?? 0, e.quote));
  return out;
}
