import { describe, expect, it } from "vitest";
import exampleSheet from "../../../agent/example-sheet.json";
// Captured once from the schemas before phone calls were added: a meeting's published shapes must not move.
import today from "./fixtures/meeting-json-schemas.json";
import {
  CALL_CLASS_TYPES,
  CallClassificationSchema,
  CallSheetSchema,
  callClassificationJsonSchema,
  classificationJsonSchema,
  SheetSchema,
  sheetJsonSchema,
  sheetSchemaFor,
} from "./schema";

type JsonSchema = { properties: Record<string, { minItems?: number; maxItems?: number; enum?: string[] }>; required: string[]; additionalProperties?: boolean };

describe("the meeting schemas", () => {
  it("publish exactly what they published before calls existed", () => {
    expect(sheetJsonSchema()).toEqual(today.sheet);
    expect(sheetJsonSchema("meeting")).toEqual(today.sheet);
    expect(classificationJsonSchema()).toEqual(today.classification);
    expect(sheetSchemaFor("meeting")).toBe(SheetSchema);
  });
});

describe("the call schemas", () => {
  it("take one to three summary bullets and are otherwise the meeting sheet", () => {
    const call = sheetJsonSchema("call") as JsonSchema;
    expect(call.properties.executive_summary).toMatchObject({ minItems: 1, maxItems: 3 });
    expect(call.additionalProperties).toBe(false);
    const meeting = sheetJsonSchema() as JsonSchema;
    expect(meeting.properties.executive_summary).toMatchObject({ minItems: 3, maxItems: 3 });
    expect(call.required.sort()).toEqual(meeting.required.sort());
    expect(sheetSchemaFor("call")).toBe(CallSheetSchema);
  });

  it("accept a two-bullet sheet that the meeting schema refuses, and refuse extra keys", () => {
    const twoBullets = { ...exampleSheet, executive_summary: exampleSheet.executive_summary.slice(0, 2) };
    expect(CallSheetSchema.safeParse(twoBullets).success).toBe(true);
    expect(SheetSchema.safeParse(twoBullets).success).toBe(false);
    expect(CallSheetSchema.safeParse({ ...twoBullets, executive_summary: [] }).success).toBe(false);
    expect(CallSheetSchema.safeParse({ ...exampleSheet, executive_summary: [...exampleSheet.executive_summary, "A fourth bullet."] }).success).toBe(false);
    expect(CallSheetSchema.safeParse({ ...twoBullets, extra: 1 }).success).toBe(false);
  });

  it("classify a call as client, vendor or one of the not-work types", () => {
    const schema = callClassificationJsonSchema() as JsonSchema;
    expect(schema.properties.type.enum).toEqual([...CALL_CLASS_TYPES]);
    expect(schema.required).toEqual(expect.arrayContaining(["type", "confidence", "reason", "evidence", "client_name_guess", "language"]));
    const answer = { type: "vendor", confidence: 0.9, reason: "Linen supplier confirming the delivery.", evidence: [], client_name_guess: "Patel Linen", language: "hinglish" };
    expect(CallClassificationSchema.safeParse(answer).success).toBe(true);
    expect(CallClassificationSchema.safeParse({ ...answer, type: "other" }).success).toBe(false);
    expect(CallClassificationSchema.safeParse({ ...answer, reason: "ok" }).success).toBe(false);
    expect(CallClassificationSchema.safeParse({ ...answer, note: "x" }).success).toBe(false);
  });
});
