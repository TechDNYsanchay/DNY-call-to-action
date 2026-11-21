// Deepgram's words -> the speaker turns every transcript in this app is stored as (the SpeakerTurn shape
// of src/lib/tldv/turns.ts, read back by parseTurns). Pure.
// Turns stay short on purpose (no 60 s merge as for tl;dv): the sheet checks look for a quote within one
// turn of its marker, and the call page seeks to the turn. Voices get machine labels "Speaker 1",
// "Speaker 2", ... in order of first speech: recordings are mono and Deepgram sometimes splits one voice in
// two, so a guessed name could send a task to the wrong person; the routine maps labels in the sheet.

import type { DeepgramWord, SpeakerTurn } from "./types";

/** A pause this long starts a new turn even when the same voice goes on (Sales QA's TURN_BREAK_SEC). */
export const TURN_BREAK_SEC = 2;
/** A turn this long breaks at the next sentence end... */
export const SENTENCE_BREAK_SEC = 15;
/** ...and is cut anyway once it reaches this length. */
export const MAX_TURN_SEC = 25;

const EPSILON = 1e-6;
const round = (sec: number) => Math.round(sec * 100) / 100;
const endsSentence = (text: string) => /[.?!।]["')\]]*$/.test(text);

export function wordsToCallTurns(words: DeepgramWord[]): SpeakerTurn[] {
  const labels = new Map<number, string>();
  const turns: SpeakerTurn[] = [];
  let lastWord = "";
  for (const w of words) {
    const text = (w.punctuated_word ?? w.word ?? "").trim();
    const start = Number(w.start);
    const end = Number(w.end);
    if (!text || !Number.isFinite(start)) continue;
    const id = Number.isFinite(Number(w.speaker)) ? Number(w.speaker) : 0;
    if (!labels.has(id)) labels.set(id, `Speaker ${labels.size + 1}`);
    const speaker = labels.get(id)!;
    const last = turns.at(-1);
    const length = last ? last.endSec - last.startSec : 0;
    const startsNew =
      !last ||
      last.speaker !== speaker ||
      start - last.endSec >= TURN_BREAK_SEC - EPSILON ||
      (length >= SENTENCE_BREAK_SEC - EPSILON && endsSentence(lastWord)) ||
      length >= MAX_TURN_SEC - EPSILON;
    const wordEnd = Number.isFinite(end) ? Math.max(start, end) : start;
    if (startsNew || !last) {
      turns.push({ speaker, startSec: round(start), endSec: round(wordEnd), text });
    } else {
      last.text += ` ${text}`;
      last.endSec = round(Math.max(last.endSec, wordEnd));
    }
    lastWord = text;
  }
  return turns;
}

/** Distinct voices in the turns; 1 means only one side of the call was recorded. */
export function speakerCountOf(turns: SpeakerTurn[]): number {
  return new Set(turns.map((t) => t.speaker)).size;
}
