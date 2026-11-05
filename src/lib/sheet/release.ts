import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { logAgentRun, logPipelineEvent, readAgentSettings } from "./settings";

export interface ReleaseOutcome {
  ok: boolean;
  status: "skipped" | "ready" | "failed" | null;
  errors: string[];
}

/** The routine found the meeting is not a client meeting (or has no usable content): label it and stop. */
export async function skipMeeting(meetingId: string, type: "sales" | "internal" | "other", reason: string): Promise<ReleaseOutcome> {
  const db = supabaseAdmin();
  const { data: meeting, error } = await db.from("meetings").select("id, type_source, process_attempts").eq("id", meetingId).maybeSingle();
  if (error) return { ok: false, status: null, errors: [error.message] };
  if (!meeting) return { ok: false, status: null, errors: ["Meeting not found"] };
  // A person's label is final: the routine may still stop working on it, but never relabels it.
  const relabel = meeting.type_source === "human" ? {} : { type, type_source: "llm" as const, type_reason: reason };
  const { error: updateError } = await db
    .from("meetings")
    .update({ ...relabel, process_status: "skipped", claimed_at: null, failure_reason: null })
    .eq("id", meetingId);
  if (updateError) return { ok: false, status: null, errors: [updateError.message] };
  await logAgentRun(meetingId, "skip", "ok", meeting.process_attempts, `Skipped as ${type}: ${reason}`);
  await logPipelineEvent(meetingId, "info", "agent", `Routine skipped the meeting as ${type}`);
  return { ok: true, status: "skipped", errors: [] };
}

/** The routine gives a meeting back: it returns to the queue, or fails once the attempts are used up. */
export async function releaseMeeting(meetingId: string, reason: string): Promise<ReleaseOutcome> {
  const db = supabaseAdmin();
  const [{ data: meeting, error }, settings] = await Promise.all([
    db.from("meetings").select("id, process_attempts, process_status").eq("id", meetingId).maybeSingle(),
    readAgentSettings(),
  ]);
  if (error) return { ok: false, status: null, errors: [error.message] };
  if (!meeting) return { ok: false, status: null, errors: ["Meeting not found"] };
  if (meeting.process_status !== "processing") return { ok: false, status: null, errors: [`Meeting is ${meeting.process_status}, not processing; nothing to release`] };
  const failed = meeting.process_attempts >= settings.maxAttempts;
  const trimmed = reason.trim().slice(0, 500) || "No reason given";
  const { error: updateError } = await db
    .from("meetings")
    .update(failed ? { process_status: "failed", claimed_at: null, failure_reason: `The routine gave up after ${meeting.process_attempts} attempts: ${trimmed}` } : { process_status: "ready", claimed_at: null })
    .eq("id", meetingId);
  if (updateError) return { ok: false, status: null, errors: [updateError.message] };
  await logAgentRun(meetingId, failed ? "fail" : "release", "ok", meeting.process_attempts, trimmed);
  await logPipelineEvent(meetingId, failed ? "error" : "warn", "agent", failed ? `Routine gave up after ${meeting.process_attempts} attempts` : `Routine released the meeting: ${trimmed}`);
  return { ok: true, status: failed ? "failed" : "ready", errors: [] };
}
