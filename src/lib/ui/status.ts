// Words and tones for a meeting's processing state, and the steps of the processing timeline.
// Pure, so the inbox row, the meeting page and the timeline all say the same thing.

import type { Database } from "@/lib/supabase/database.types";

export type ProcessStatus = Database["public"]["Enums"]["process_status"];
export type MeetingType = Database["public"]["Enums"]["meeting_type"];
export type TypeSource = Database["public"]["Enums"]["type_source"];

/** Semantic tone of a status dot: colour is never the only signal, the word goes next to it. */
export type Tone = "ink" | "bottle" | "sienna" | "signal" | "slate" | "muted" | "pulse";

/** The quiet word shown next to a meeting that has no sheet yet. */
export function statusWord(status: ProcessStatus): string {
  switch (status) {
    case "new":
      return "Fetching transcript";
    case "waiting_transcript":
      return "Waiting for transcript";
    case "ready":
      return "Waiting for the next run";
    case "processing":
      return "Analysing";
    case "needs_decision":
      return "Needs your decision";
    case "done":
      return "Ready";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
  }
}

export function statusTone(status: ProcessStatus): Tone {
  switch (status) {
    case "done":
      return "bottle";
    case "failed":
      return "signal";
    case "needs_decision":
      return "sienna";
    case "processing":
      return "pulse";
    case "skipped":
      return "muted";
    default:
      return "slate";
  }
}

/** "Client meeting", "Sales meeting", ... for the type chip. */
export function typeLabel(type: MeetingType): string {
  switch (type) {
    case "client":
      return "Client meeting";
    case "sales":
      return "Sales meeting";
    case "internal":
      return "Internal";
    case "other":
      return "Other";
    case "unknown":
      return "Type not decided";
  }
}

export function sourceLabel(source: TypeSource | null): string {
  if (source === "rule") return "by rule";
  if (source === "llm") return "by the model";
  if (source === "human") return "by a person";
  return "";
}

/** "94%" for a 0..1 value; the words are only shown below the threshold. */
export const percent = (value: number | null | undefined): string => (value == null ? "" : `${Math.round(value * 100)}%`);

/** Shown when the model is unsure; above the threshold nothing is said. */
export function confidenceWord(value: number | null | undefined, threshold = 0.8): string | null {
  if (value == null || value >= threshold) return null;
  return value < 0.5 ? `Model is unsure (${percent(value)})` : `Model is fairly sure (${percent(value)})`;
}

export type StepState = "done" | "active" | "todo" | "failed";

export interface TimelineStep {
  key: "transcript" | "classified" | "queued" | "analysing" | "ready";
  label: string;
  state: StepState;
  /** Muted hint under the active step, e.g. "about hourly". */
  hint?: string;
}

export interface TimelineInput {
  process_status: ProcessStatus;
  type: MeetingType;
  type_source: TypeSource | null;
  transcript_ready: boolean;
  failure_reason?: string | null;
}

/**
 * The five steps a meeting goes through before its sheet exists, derived from the row alone so the
 * page renders the right picture on load and after every realtime refresh.
 */
export function timelineSteps(m: TimelineInput): TimelineStep[] {
  const decided = m.type_source === "human" || (m.type_source === "rule" && m.type !== "unknown") || m.type_source === "llm";
  const s = m.process_status;
  const transcript: StepState = m.transcript_ready ? "done" : s === "failed" ? "failed" : "active";
  const classified: StepState = s === "needs_decision" ? "active" : decided && m.transcript_ready ? "done" : m.transcript_ready ? (s === "processing" ? "active" : "todo") : "todo";
  const queued: StepState = s === "ready" ? "active" : s === "processing" || s === "done" ? "done" : "todo";
  const analysing: StepState = s === "processing" ? "active" : s === "done" ? "done" : s === "failed" && m.transcript_ready ? "failed" : "todo";
  const ready: StepState = s === "done" ? "done" : "todo";
  return [
    { key: "transcript", label: m.transcript_ready ? "Transcript received" : "Waiting for the transcript from tl;dv", state: transcript, hint: transcript === "active" ? "tl;dv can take up to two hours after a meeting ends" : undefined },
    { key: "classified", label: s === "needs_decision" ? "Needs your decision on the type" : decided ? `Classified as ${typeLabel(m.type).toLowerCase()}` : "Classifying", state: classified },
    { key: "queued", label: "Waiting for the next analysis run", state: queued, hint: queued === "active" ? "The routine runs about hourly" : undefined },
    { key: "analysing", label: "Analysing the meeting", state: analysing, hint: analysing === "active" ? "Usually a few minutes" : undefined },
    { key: "ready", label: "Sheet ready", state: ready },
  ];
}
