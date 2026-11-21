import { describe, expect, it } from "vitest";
import { countSentences } from "@/lib/ingest/decisions";
import { wordCount } from "@/lib/tldv/turns";
import fiveWords from "./fixtures/deepgram-five-words.json";
import response from "./fixtures/deepgram-response.json";
import silence from "./fixtures/deepgram-silence.json";
import { speakerCountOf, wordsToCallTurns } from "./turns";
import type { DeepgramWord } from "./types";

const wordsOf = (json: { results: { channels: Array<{ alternatives: Array<{ words: DeepgramWord[] }> }> } }) => json.results.channels[0].alternatives[0].words;

/** Words of one second each from `from`, one voice, with the given punctuation at the given word ends. */
function monologue(from: number, to: number, sentenceEnds: number[] = [], speaker = 0): DeepgramWord[] {
  const out: DeepgramWord[] = [];
  for (let s = from; s < to; s++) {
    const end = s + 1;
    const word = `w${end}`;
    out.push({ word, punctuated_word: sentenceEnds.includes(end) ? `${word}.` : word, start: s, end, speaker });
  }
  return out;
}

describe("wordsToCallTurns", () => {
  it("labels voices Speaker 1, Speaker 2 in order of first speech", () => {
    const turns = wordsToCallTurns([
      { word: "hello", start: 0, end: 0.5, speaker: 1 },
      { word: "haan", start: 1, end: 1.4, speaker: 0 },
      { word: "theek", start: 2, end: 2.4, speaker: 1 },
    ]);
    expect(turns.map((t) => t.speaker)).toEqual(["Speaker 1", "Speaker 2", "Speaker 1"]);
  });

  it("starts a turn on a speaker change and on a pause of 2 s", () => {
    const words: DeepgramWord[] = [
      { word: "one", start: 0, end: 1.1, speaker: 0 },
      { word: "two", start: 3.0, end: 3.4, speaker: 0 },
      { word: "three", start: 5.4, end: 5.8, speaker: 0 },
    ];
    // 3.0 - 1.1 = 1.9 s: same turn. 5.4 - 3.4 = 2.0 s: a new turn.
    expect(wordsToCallTurns(words).map((t) => t.text)).toEqual(["one two", "three"]);
  });

  it("breaks a long turn at the first sentence end after 15 s", () => {
    const turns = wordsToCallTurns(monologue(0, 40, [12, 17, 30]));
    expect(turns.map((t) => [t.startSec, t.endSec])).toEqual([
      [0, 17],
      [17, 40],
    ]);
  });

  it("cuts a run-on turn at 25 s", () => {
    const turns = wordsToCallTurns(monologue(0, 30));
    expect(turns.map((t) => [t.startSec, t.endSec])).toEqual([
      [0, 25],
      [25, 30],
    ]);
  });

  it("rounds times to 0.01 s, prefers the punctuated word and skips empty words", () => {
    const turns = wordsToCallTurns([
      { word: "hello", punctuated_word: "Hello,", start: 0.123456, end: 0.456789, speaker: 0 },
      { word: "", start: 0.5, end: 0.6, speaker: 0 },
      { word: "ji", start: 0.7, end: 0.987654 },
    ]);
    expect(turns).toEqual([{ speaker: "Speaker 1", startSec: 0.12, endSec: 0.99, text: "Hello, ji" }]);
  });

  it("returns no turns for no words, and counts the voices", () => {
    expect(wordsToCallTurns([])).toEqual([]);
    expect(wordsToCallTurns(wordsOf(silence))).toEqual([]);
    expect(speakerCountOf([])).toBe(0);
    expect(speakerCountOf(wordsToCallTurns(monologue(0, 5)))).toBe(1);
  });

  it("reads a Hinglish call in both scripts", () => {
    const turns = wordsToCallTurns(wordsOf(response));
    expect(turns.map((t) => t.speaker)).toEqual(["Speaker 1", "Speaker 2", "Speaker 1", "Speaker 2", "Speaker 1"]);
    expect(turns[0].text).toBe("Hello Rakesh ji, main Ashwini bol rahi hoon DNY se.");
    expect(turns[1].text).toBe("हाँ Ashwini ji, बोलिए।");
    expect(speakerCountOf(turns)).toBe(2);
    expect(wordCount(turns)).toBe(40);
    expect(countSentences(turns)).toBeGreaterThanOrEqual(5);
    expect(response.metadata.duration).toBe(147.2);
  });

  it("a five-word call stays under the 8-word floor for speech", () => {
    expect(wordCount(wordsToCallTurns(wordsOf(fiveWords)))).toBe(5);
  });
});
