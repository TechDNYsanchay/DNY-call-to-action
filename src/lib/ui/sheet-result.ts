// Reads the sheet JSON stored in sheets.result for display. The row was validated against
// SheetSchema when it was saved (plus a `verification` block the server adds), so the strict parse
// normally succeeds; if an older or hand-edited row does not, the page still renders what it can.

import type { Json } from "@/lib/supabase/database.types";
import { type Decision, type Evidence, type KeyFact, type OpenQuestion, type Risk, type Sheet, SheetSchema } from "@/lib/sheet/schema";

export interface SheetVerification {
  prompt_version?: string;
  checked_at?: string;
  warnings?: string[];
  evidence_verified?: Record<string, boolean>;
  adjusted_confidence?: Record<string, number>;
}

export interface SheetView {
  headline: string;
  executive_summary: string[];
  meeting_purpose: Sheet["meeting_purpose"] | null;
  decisions: Decision[];
  key_facts: KeyFact[];
  risks: Risk[];
  open_questions: OpenQuestion[];
  next_meeting: Sheet["next_meeting"] | null;
  client_sentiment: Sheet["client_sentiment"] | null;
  quality: Sheet["quality"] | null;
  overall_confidence: number | null;
  verification: SheetVerification;
  /** False when the strict parse failed and the arrays were read leniently. */
  complete: boolean;
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function readSheetResult(result: Json | null, fallbackHeadline = ""): SheetView {
  const record = asRecord(result);
  const { verification: rawVerification, ...rest } = record;
  const verification = asRecord(rawVerification) as SheetVerification;
  const parsed = SheetSchema.safeParse(rest);
  if (parsed.success) {
    const s = parsed.data;
    return {
      headline: s.headline,
      executive_summary: s.executive_summary,
      meeting_purpose: s.meeting_purpose,
      decisions: s.decisions,
      key_facts: s.key_facts,
      risks: s.risks,
      open_questions: s.open_questions,
      next_meeting: s.next_meeting,
      client_sentiment: s.client_sentiment,
      quality: s.quality,
      overall_confidence: s.overall_confidence,
      verification,
      complete: true,
    };
  }
  return {
    headline: typeof rest.headline === "string" ? rest.headline : fallbackHeadline,
    executive_summary: asArray<string>(rest.executive_summary).filter((x) => typeof x === "string"),
    meeting_purpose: null,
    decisions: asArray<Decision>(rest.decisions).filter((d) => typeof d?.statement === "string"),
    key_facts: asArray<KeyFact>(rest.key_facts).filter((f) => typeof f?.fact === "string"),
    risks: asArray<Risk>(rest.risks).filter((r) => typeof r?.description === "string"),
    open_questions: asArray<OpenQuestion>(rest.open_questions).filter((q) => typeof q?.question === "string"),
    next_meeting: null,
    client_sentiment: null,
    quality: null,
    overall_confidence: typeof rest.overall_confidence === "number" ? rest.overall_confidence : null,
    verification,
    complete: false,
  };
}

/** Whether the server could find an item's quotes in the transcript (by the model's id, e.g. "D1"). */
export const evidenceVerified = (view: SheetView, id: string): boolean => view.verification.evidence_verified?.[id] ?? true;

/** The first quote of an entry, as the row shows it. */
export const firstEvidence = (evidence: Evidence[] | undefined): Evidence | null => evidence?.[0] ?? null;

export const SENTIMENT_WORDS: Record<Sheet["client_sentiment"]["label"], string> = {
  very_positive: "Very positive",
  positive: "Positive",
  neutral: "Neutral",
  concerned: "Concerned",
  frustrated: "Frustrated",
  mixed: "Mixed",
};

export const PURPOSE_WORDS: Record<Sheet["meeting_purpose"], string> = {
  review: "Review",
  onboarding: "Onboarding",
  operations: "Operations",
  escalation: "Escalation",
  training: "Training",
  planning: "Planning",
  renewal_or_commercial: "Renewal or commercial",
  other: "Other",
};
