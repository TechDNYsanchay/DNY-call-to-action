import { describe, expect, it } from "vitest";
import exampleCallSheet from "../../../agent/example-call-sheet.json";
import exampleCallTranscript from "../../../agent/example-call-transcript.json";
import exampleSheet from "../../../agent/example-sheet.json";
import exampleTranscript from "../../../agent/example-transcript.json";
import { secondsFrom } from "@/lib/format";
import { CallSheetSchema, SheetSchema } from "@/lib/sheet/schema";
import { refineEvidenceSeconds, refineQuoteSecond } from "./seek";
import type { SpeakerTurn } from "./types";

const turns: SpeakerTurn[] = [
  { speaker: "Speaker 1", startSec: 100, endSec: 120, text: "One two three four five six seven eight nine ten, send the revised menu costing by Friday. Ok thank" },
  { speaker: "Speaker 2", startSec: 120, endSec: 130, text: "Haan theek hai, main vendor bills kal share kar dunga." },
  { speaker: "Speaker 1", startSec: 130, endSec: 140, text: "Aur ek baat jo humne pichli baar discuss ki thi" },
  { speaker: "Speaker 2", startSec: 140, endSec: 141, text: "Haan." },
  { speaker: "Speaker 1", startSec: 141, endSec: 150, text: "uska invoice bhi saath mein bhej dena please." },
  { speaker: "Speaker 2", startSec: 300, endSec: 310, text: "Theek hai ji, bilkul." },
  { speaker: "Speaker 1", startSec: 400, endSec: 410, text: "Main kal subah" },
  { speaker: "Speaker 1", startSec: 412, endSec: 420, text: "office aa jaunga." },
];

describe("refineQuoteSecond", () => {
  it("interpolates inside the turn: a quote half-way into a 20 s turn is about 10 s in", () => {
    expect(refineQuoteSecond(100, "send the revised menu costing", turns)).toBeCloseTo(110, 0);
  });

  it("finds a quote in the turn after the marker", () => {
    const sec = refineQuoteSecond(100, "main vendor bills kal share", turns);
    expect(sec).toBeGreaterThan(120);
    expect(sec).toBeLessThan(130);
  });

  it("finds a quote in the turn before the marker", () => {
    const sec = refineQuoteSecond(120, "nine ten, send the revised menu", turns);
    expect(sec).toBeGreaterThan(100);
    expect(sec).toBeLessThan(120);
  });

  it("finds a quote spanning two turns of the same voice, also when another voice cut in", () => {
    const joined = refineQuoteSecond(400, "kal subah office aa", turns);
    expect(joined).toBeGreaterThan(400);
    expect(joined).toBeLessThan(410);
    const cutIn = refineQuoteSecond(130, "jo humne pichli baar discuss ki thi uska invoice bhi", turns);
    expect(cutIn).toBeGreaterThan(130);
    expect(cutIn).toBeLessThan(140);
  });

  it("takes the occurrence nearest the marker when a quote is said twice, the earlier on a tie", () => {
    expect(refineQuoteSecond(300, "theek hai", turns)).toBe(300);
    expect(refineQuoteSecond(125, "theek hai", turns)).toBeGreaterThan(120);
    expect(refineQuoteSecond(125, "theek hai", turns)).toBeLessThan(130);
    expect(refineQuoteSecond(210, "theek hai", turns)).toBeLessThan(130);
  });

  it("keeps the marker when the quote is empty or not in the transcript", () => {
    expect(refineQuoteSecond(77, "this was never said", turns)).toBe(77);
    expect(refineQuoteSecond(77, "", turns)).toBe(77);
    expect(refineQuoteSecond(77, null, turns)).toBe(77);
    expect(refineQuoteSecond(77, "theek hai", [])).toBe(77);
  });

  it("matches whole words only", () => {
    expect(refineQuoteSecond(77, "ice bhi saath", turns)).toBe(77);
  });

  it("rounds to 0.01 s", () => {
    const sec = refineQuoteSecond(120, "vendor bills", turns);
    expect(Math.round(sec * 100) / 100).toBe(sec);
  });
});

describe("refineEvidenceSeconds", () => {
  const sheet = SheetSchema.parse(exampleSheet);
  const transcript = exampleTranscript as SpeakerTurn[];
  const refined = refineEvidenceSeconds(sheet, transcript);

  it("keys every entry of the sheet, one second per evidence entry", () => {
    const ids = [...sheet.action_items, ...sheet.decisions, ...sheet.key_facts, ...sheet.risks, ...sheet.open_questions].map((e) => e.id);
    expect(Object.keys(refined).sort()).toEqual([...ids, "next_meeting", "client_sentiment"].sort());
    expect(refined.A1).toHaveLength(sheet.action_items[0].evidence.length);
    expect(refined.next_meeting).toHaveLength(sheet.next_meeting.evidence.length);
  });

  it("places every verbatim quote inside the turn its marker points at", () => {
    const all: Array<[string, { timestamp: string }[]]> = [
      ...[...sheet.action_items, ...sheet.decisions, ...sheet.key_facts, ...sheet.risks, ...sheet.open_questions].map((e): [string, { timestamp: string }[]] => [e.id, e.evidence]),
      ["next_meeting", sheet.next_meeting.evidence],
      ["client_sentiment", sheet.client_sentiment.evidence],
    ];
    for (const [id, evidence] of all) {
      evidence.forEach((e, i) => {
        const marker = secondsFrom(e.timestamp)!;
        const turn = transcript.find((t) => Math.floor(t.startSec) === marker)!;
        expect(refined[id][i], `${id}[${i}]`).toBeGreaterThanOrEqual(marker);
        expect(refined[id][i], `${id}[${i}]`).toBeLessThanOrEqual(turn.endSec);
      });
    }
  });
});

describe("refineEvidenceSeconds on the example call", () => {
  const sheet = CallSheetSchema.parse(exampleCallSheet);
  const transcript = exampleCallTranscript as SpeakerTurn[];
  const refined = refineEvidenceSeconds(sheet, transcript);

  it("keys every entry id of the example call sheet, one second per evidence entry", () => {
    const ids = [...sheet.action_items, ...sheet.decisions, ...sheet.key_facts, ...sheet.risks, ...sheet.open_questions].map((e) => e.id);
    expect(Object.keys(refined).sort()).toEqual([...ids, "next_meeting", "client_sentiment"].sort());
    expect(refined.A2).toHaveLength(2);
    expect(refined.D1).toHaveLength(2);
  });

  it("places a quote said mid-turn after the turn's start, inside the turn", () => {
    // "Bas dhyan rakhna ..." follows "Friday theek hai." in the turn that starts at 1:08 (68.2 s).
    const [, second] = refined.D1;
    expect(second).toBeGreaterThan(68.2);
    expect(second).toBeLessThan(76.4);
    // "Aur main revised ..." follows a one-word "Perfect." at the start of the 0:59 turn.
    expect(refined.A1[0]).toBeGreaterThan(59);
    expect(refined.A1[0]).toBeLessThan(61);
  });
});
