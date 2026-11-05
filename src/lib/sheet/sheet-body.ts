// Small pure helpers around the sheet body the routine posts. Kept out of save.ts so they can be tested.

import type { Sheet } from "./schema";

export interface SheetCounts {
  dny: number;
  client: number;
  decisions: number;
  facts: number;
  risks: number;
  questions: number;
}

/** The scoreboard numbers; "both" counts in each lane because each side owes something. */
export const countsOf = (sheet: Sheet): SheetCounts => ({
  dny: sheet.action_items.filter((a) => a.owed_by === "dny" || a.owed_by === "both").length,
  client: sheet.action_items.filter((a) => a.owed_by === "client" || a.owed_by === "both").length,
  decisions: sheet.decisions.length,
  facts: sheet.key_facts.length,
  risks: sheet.risks.length,
  questions: sheet.open_questions.length,
});

/** The optional "model" field rides along with the sheet; the strict schema must not see it. */
export function splitModel(json: unknown): { sheet: unknown; model: string | null } {
  if (json && typeof json === "object" && !Array.isArray(json) && "model" in json) {
    const { model, ...sheet } = json as Record<string, unknown>;
    return { sheet, model: typeof model === "string" && model.trim() ? model.trim().slice(0, 120) : null };
  }
  return { sheet: json, model: null };
}
