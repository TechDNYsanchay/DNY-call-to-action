import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/** The settings the routine's work API depends on, with the migration's defaults as fallbacks. */
export interface AgentSettings {
  confidenceThreshold: number;
  maxAttempts: number;
  maxPerRun: number;
  pipelinePaused: boolean;
}

const DEFAULTS: AgentSettings = { confidenceThreshold: 0.8, maxAttempts: 3, maxPerRun: 5, pipelinePaused: false };

export async function readAgentSettings(): Promise<AgentSettings> {
  const { data, error } = await supabaseAdmin().from("settings").select("key, value").in("key", ["confidence_threshold", "max_attempts", "max_per_run", "pipeline_paused"]);
  if (error) throw new Error(`settings: ${error.message}`);
  const map = new Map((data ?? []).map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number) => {
    const v = Number(map.get(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    confidenceThreshold: num("confidence_threshold", DEFAULTS.confidenceThreshold),
    maxAttempts: num("max_attempts", DEFAULTS.maxAttempts),
    maxPerRun: num("max_per_run", DEFAULTS.maxPerRun),
    pipelinePaused: map.get("pipeline_paused") === true,
  };
}

/** One line in agent_runs per call the routine makes, so the meeting page can show what happened. */
export async function logAgentRun(meetingId: string, kind: "claim" | "classify" | "extract" | "skip" | "fail" | "release", status: "ok" | "rejected" | "error", attempt: number, summary: string, errors?: unknown): Promise<void> {
  const { error } = await supabaseAdmin().from("agent_runs").insert({ meeting_id: meetingId, kind, status, attempt, summary, errors: errors === undefined ? null : (errors as never) });
  if (error) console.warn(`agent_runs: ${error.message}`);
}

/** One line in the operations log; never contains transcript text. */
export async function logPipelineEvent(meetingId: string | null, level: "info" | "warn" | "error", step: string, message: string): Promise<void> {
  const { error } = await supabaseAdmin().from("pipeline_events").insert({ meeting_id: meetingId, level, step, message });
  if (error) console.warn(`pipeline_events: ${error.message}`);
}
