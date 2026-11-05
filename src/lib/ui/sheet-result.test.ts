import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceVerified, readSheetResult } from "./sheet-result";

const example = JSON.parse(readFileSync(path.join(process.cwd(), "agent/example-sheet.json"), "utf8"));

describe("readSheetResult", () => {
  it("reads a saved sheet with its verification block", () => {
    const view = readSheetResult({ ...example, verification: { evidence_verified: { D1: false }, warnings: ["x"] } });
    expect(view.complete).toBe(true);
    expect(view.decisions.length).toBe(example.decisions.length);
    expect(view.next_meeting?.date).toBe("2026-11-11");
    expect(evidenceVerified(view, "D1")).toBe(false);
    expect(evidenceVerified(view, "D2")).toBe(true);
  });

  it("falls back to a lenient read when the shape is off", () => {
    const view = readSheetResult({ headline: "Short", decisions: [{ id: "D1", statement: "We agreed" }, { bad: true }], risks: "nope" }, "Fallback");
    expect(view.complete).toBe(false);
    expect(view.headline).toBe("Short");
    expect(view.decisions.map((d) => d.statement)).toEqual(["We agreed"]);
    expect(view.risks).toEqual([]);
    expect(readSheetResult(null, "Fallback").headline).toBe("Fallback");
  });
});
