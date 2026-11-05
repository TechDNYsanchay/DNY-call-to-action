import { describe, expect, it } from "vitest";
import { z } from "zod";
import exampleSheet from "../../../agent/example-sheet.json";
import exampleTranscript from "../../../agent/example-transcript.json";
import { parseTldvTranscript } from "@/lib/tldv/parse";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import { ClassificationSchema, classificationJsonSchema, SheetSchema, sheetJsonSchema } from "./schema";
import { countsOf, splitModel } from "./sheet-body";
import { buildTranscriptLines } from "./transcript-lines";
import { checkSheet } from "./verify";
import { zodIssues } from "./zod-issues";

const turns = exampleTranscript as SpeakerTurn[];
const participants = [
  { name: "Priya Nair", email: "priya@dnyhospitality.com", side: "dny" as const },
  { name: "Arjun Mehta", email: "arjun@dnyhospitality.com", side: "dny" as const },
  { name: "Rakesh Agarwal", email: "rakesh@saffroncourt.example", side: "client" as const },
  { name: "Sunita Rao", email: "gm@saffroncourt.example", side: "client" as const },
];

describe("agent/example-sheet.json", () => {
  it("passes the sheet schema", () => {
    const parsed = SheetSchema.safeParse(exampleSheet);
    expect(parsed.success ? [] : zodIssues(parsed.error)).toEqual([]);
  });

  it("passes every server check against its own transcript, with no warnings", () => {
    const sheet = SheetSchema.parse(exampleSheet);
    const result = checkSheet(sheet, {
      turns,
      durationSec: 1800,
      meetingDateIst: "2026-11-04",
      participantNames: participants.map((p) => p.name),
      speakerLabels: [...new Set(turns.map((t) => t.speaker))],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(Object.values(result.evidenceVerified).every(Boolean)).toBe(true);
    expect(countsOf(sheet)).toMatchObject({ dny: 10, client: 3, decisions: 3 });
  });

  it("describes a Hinglish meeting with reliable speaker labels", () => {
    const lines = buildTranscriptLines(turns, participants, []);
    expect(lines.language.hint).toBe("hinglish");
    expect(lines.speakerLabelsReliable).toBe(true);
    expect(lines.lines[0]).toMatch(/^\[0:30\] Priya Nair \(DNY\): /);
    expect(turns.length).toBeGreaterThanOrEqual(60);
  });

  it("is a transcript shape tl;dv's parser also accepts", () => {
    const sentences = turns.map((t) => ({ speaker: t.speaker, text: t.text, startTime: t.startSec, endTime: t.endSec }));
    expect(parseTldvTranscript({ data: sentences })?.length).toBeGreaterThan(0);
  });
});

describe("published JSON schemas", () => {
  it("are draft-7 documents with the top-level fields", () => {
    const sheet = sheetJsonSchema() as { $schema?: string; required?: string[] };
    expect(sheet.$schema).toContain("draft-07");
    expect(sheet.required).toContain("action_items");
    const cls = classificationJsonSchema() as { required?: string[] };
    expect(cls.required).toContain("type");
  });
  it("classification example validates", () => {
    expect(ClassificationSchema.safeParse({ type: "client", confidence: 0.92, reason: "Monthly review with an existing client.", evidence: [], client_name_guess: "Saffron Court", language: "hinglish" }).success).toBe(true);
  });
});

describe("splitModel and zodIssues", () => {
  it("peels the optional model field off the body", () => {
    expect(splitModel({ model: " claude-opus-5-5 ", headline: "x" })).toEqual({ sheet: { headline: "x" }, model: "claude-opus-5-5" });
    expect(splitModel({ headline: "x" })).toEqual({ sheet: { headline: "x" }, model: null });
    expect(splitModel("nope")).toEqual({ sheet: "nope", model: null });
  });
  it("renders issues as path: message and caps the list", () => {
    const r = z.object({ a: z.string(), b: z.object({ c: z.number() }) }).safeParse({ a: 1, b: { c: "x" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      const lines = zodIssues(r.error);
      expect(lines[0]).toMatch(/^a: /);
      expect(lines[1]).toMatch(/^b\.c: /);
      expect(zodIssues(r.error, 1)).toHaveLength(2);
      expect(zodIssues(r.error, 1)[1]).toContain("1 more");
    }
  });
});
