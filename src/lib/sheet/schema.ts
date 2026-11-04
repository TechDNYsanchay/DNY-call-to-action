// The sheet: the JSON the routine returns for one client meeting. The server validates against this
// (zod) and publishes the JSON Schema in the work package so the routine copies the exact shape.

import { z } from "zod";

const confidence = z.number().min(0).max(1);

export const EvidenceSchema = z
  .object({
    timestamp: z.string().describe("The marker of the transcript line relied on, copied exactly, e.g. 12:34 or 1:02:10"),
    speaker: z.string().describe("Speaker label exactly as it appears on that line, without the (DNY)/(Client) tag"),
    quote: z.string().min(1).max(400).describe("Verbatim words from that line, original language and script, at most 30 words"),
    quote_english: z.string().nullable().describe("Plain-English rendering when the quote is not already English; null otherwise"),
  })
  .strict();

export const SideSchema = z.enum(["dny", "client", "both", "unclear"]);

export const ActionItemSchema = z
  .object({
    id: z.string().describe("A1, A2, ..."),
    title: z.string().min(3).max(140).describe("Verb-first, at most 12 words, e.g. 'Share revised duty roster with owner'"),
    details: z.string().max(1000).describe("What exactly, why, any conditions; one to three sentences; empty string if the title says it all"),
    owed_by: SideSchema.describe("Who owes this task: dny or client (both when it is genuinely joint)"),
    owner: z
      .object({
        name: z.string().nullable().describe("Canonical participant name only when the transcript supports it; null otherwise"),
        side: z.enum(["dny", "client", "unknown"]),
        basis: z.enum(["explicitly_assigned", "volunteered", "implied_by_role", "not_stated"]),
      })
      .strict(),
    due: z
      .object({
        kind: z.enum(["explicit_date", "relative_phrase", "asap", "none_stated"]),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe("YYYY-MM-DD, only when explicit or unambiguously derivable from the meeting date"),
        raw_phrase: z.string().nullable().describe("The words used, e.g. 'by Friday', 'agle hafte tak'"),
        basis: z.string().nullable().describe("How the date was derived, e.g. 'meeting on Tue 4 Nov; next Friday = 7 Nov'"),
      })
      .strict(),
    priority: z.enum(["high", "medium", "low"]),
    linked_decision_id: z.string().nullable().describe("Decision id this task implements, if any"),
    evidence: z.array(EvidenceSchema).min(1).max(3),
    confidence,
  })
  .strict();

export const DecisionSchema = z
  .object({
    id: z.string().describe("D1, D2, ..."),
    statement: z.string().min(3).max(300).describe("The decision as a plain statement of fact"),
    decided_by: z.enum(["dny", "client", "joint", "unclear"]),
    evidence: z.array(EvidenceSchema).min(1).max(3),
    confidence,
  })
  .strict();

export const KeyFactSchema = z
  .object({
    id: z.string().describe("F1, F2, ..."),
    fact: z.string().min(3).max(300).describe("One sentence, value as said"),
    category: z.enum(["money", "date", "quantity", "metric", "contract", "staffing", "property", "process", "other"]),
    normalized_value: z.string().nullable().describe("Machine-friendly form, e.g. 'INR 250000', '2026-11-15', '72%'"),
    evidence: z.array(EvidenceSchema).min(1).max(3),
    confidence,
  })
  .strict();

export const RiskSchema = z
  .object({
    id: z.string().describe("R1, R2, ..."),
    description: z.string().min(3).max(400),
    severity: z.enum(["high", "medium", "low"]),
    affects: SideSchema,
    mitigation_discussed: z.string().nullable().describe("What the participants said they would do about it, if anything"),
    evidence: z.array(EvidenceSchema).min(1).max(3),
    confidence,
  })
  .strict();

export const OpenQuestionSchema = z
  .object({
    id: z.string().describe("Q1, Q2, ..."),
    question: z.string().min(3).max(300),
    raised_by: z.enum(["dny", "client", "unclear"]),
    needs_answer_from: z.enum(["dny", "client", "unclear"]),
    evidence: z.array(EvidenceSchema).min(1).max(3),
    confidence,
  })
  .strict();

export const SheetSchema = z
  .object({
    headline: z.string().min(10).max(160).describe("One sentence, at most 140 characters, stating the outcome of the meeting"),
    executive_summary: z.array(z.string().min(3).max(300)).length(3).describe("Exactly 3 bullets, most important first, each self-contained"),
    meeting_purpose: z.enum(["review", "onboarding", "operations", "escalation", "training", "planning", "renewal_or_commercial", "other"]),
    language_profile: z
      .object({
        primary: z.enum(["english", "hindi", "hinglish", "other"]),
        mixed: z.boolean(),
        notes: z.string().nullable(),
      })
      .strict(),
    action_items: z.array(ActionItemSchema).max(40),
    decisions: z.array(DecisionSchema).max(30),
    key_facts: z.array(KeyFactSchema).max(40),
    risks: z.array(RiskSchema).max(20),
    open_questions: z.array(OpenQuestionSchema).max(20),
    next_meeting: z
      .object({
        mentioned: z.boolean(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        raw_phrase: z.string().nullable(),
        purpose: z.string().nullable(),
        evidence: z.array(EvidenceSchema).max(3),
        confidence,
      })
      .strict(),
    client_sentiment: z
      .object({
        label: z.enum(["very_positive", "positive", "neutral", "concerned", "frustrated", "mixed"]),
        summary: z.string().min(3).max(300).describe("One sentence on how the client side sounded about DNY and the engagement"),
        drivers: z.array(z.string().max(120)).max(8).describe("Short phrases, e.g. 'praised the new chef', 'unhappy about delayed MIS'"),
        evidence: z.array(EvidenceSchema).max(3),
        confidence,
      })
      .strict(),
    participants: z
      .array(
        z
          .object({
            speaker_label: z.string().describe("Exactly as it appears in the transcript"),
            name: z.string().nullable().describe("Canonical name from the participants list, if matched"),
            side: z.enum(["dny", "client", "third_party", "unknown"]),
            role_guess: z.string().nullable().describe("e.g. 'owner', 'GM', 'DNY account manager', only if evident"),
            confidence,
          })
          .strict(),
      )
      .max(30),
    quality: z
      .object({
        transcript_quality: z.enum(["good", "fair", "poor"]),
        speaker_labels_reliable: z.boolean(),
        issues: z.array(z.string().max(200)).max(20),
        unresolved_references: z.array(z.string().max(200)).max(20),
      })
      .strict(),
    overall_confidence: confidence,
  })
  .strict();

export type Sheet = z.infer<typeof SheetSchema>;
export type ActionItem = z.infer<typeof ActionItemSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

/** The classifier's answer when the rules could not decide. */
export const ClassificationSchema = z
  .object({
    type: z.enum(["client", "sales", "internal", "other"]).describe(
      "client = DNY already serves this party (review, onboarding, operations, escalation). sales = DNY is trying to win or quote a new engagement. internal = only DNY staff. other = vendor, recruitment, personal, or no usable content.",
    ),
    confidence: confidence.describe("0.9+ only when the transcript explicitly shows an existing engagement (client) or a first-contact pitch (sales)"),
    reason: z.string().min(3).max(400).describe("One or two plain-English sentences a non-technical reviewer can read on the card"),
    evidence: z.array(EvidenceSchema).max(3),
    client_name_guess: z.string().nullable().describe("Name of the hotel/restaurant/company on the other side if it is said in the meeting; null if not said"),
    language: z.enum(["english", "hindi", "hinglish", "other"]),
  })
  .strict();

export type Classification = z.infer<typeof ClassificationSchema>;

/** Bumped whenever the guide, the schema or the checks change; stored on every sheet. */
export const PROMPT_VERSION = "1.0.0";

/** JSON Schema for the work package, so the routine sees the exact shape it must return. */
export const sheetJsonSchema = () => z.toJSONSchema(SheetSchema, { target: "draft-7" });
export const classificationJsonSchema = () => z.toJSONSchema(ClassificationSchema, { target: "draft-7" });
