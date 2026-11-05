import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { matchClientName, routeClassification, type RoutedStatus } from "./classify-routing";
import { ClassificationSchema } from "./schema";
import { logAgentRun, logPipelineEvent, readAgentSettings } from "./settings";
import { zodIssues } from "./zod-issues";

export interface ClassifyOutcome {
  ok: boolean;
  /** Whether the routine should continue to the sheet for this meeting. */
  proceed: boolean;
  status: RoutedStatus | null;
  type: string | null;
  confidence: number | null;
  errors: string[];
}

/** Store the routine's classification and route the meeting: skipped, needs a decision, or on to the sheet. */
export async function applyClassification(meetingId: string, json: unknown): Promise<ClassifyOutcome> {
  const parsed = ClassificationSchema.safeParse(json);
  if (!parsed.success) return { ok: false, proceed: false, status: null, type: null, confidence: null, errors: zodIssues(parsed.error) };
  const c = parsed.data;
  const db = supabaseAdmin();
  const [{ data: meeting, error }, settings] = await Promise.all([
    db.from("meetings").select("id, type, type_source, client_id, process_status, process_attempts").eq("id", meetingId).maybeSingle(),
    readAgentSettings(),
  ]);
  if (error) return { ok: false, proceed: false, status: null, type: null, confidence: null, errors: [error.message] };
  if (!meeting) return { ok: false, proceed: false, status: null, type: null, confidence: null, errors: ["Meeting not found"] };
  if (meeting.process_status !== "processing") {
    return { ok: false, proceed: false, status: null, type: null, confidence: null, errors: [`Meeting is ${meeting.process_status}, not processing; call next to claim it first`] };
  }

  // A person's label is final: route by it and keep the routine's answer only as a note in agent_runs.
  if (meeting.type_source === "human") {
    const human = routeClassification(meeting.type === "client" ? "client" : "other", 1, settings.confidenceThreshold);
    await logAgentRun(meetingId, "classify", "ok", meeting.process_attempts, `Routine said ${c.type} (${c.confidence}); kept the human label ${meeting.type}`);
    if (!human.proceed) await db.from("meetings").update({ process_status: "skipped", claimed_at: null }).eq("id", meetingId);
    return { ok: true, proceed: human.proceed, status: human.status, type: meeting.type, confidence: 1, errors: [] };
  }

  const routing = routeClassification(c.type, c.confidence, settings.confidenceThreshold);
  let clientId = meeting.client_id;
  if (!clientId && c.client_name_guess) {
    const { data: clients } = await db.from("clients").select("id, name");
    clientId = matchClientName(c.client_name_guess, clients ?? [])?.id ?? null;
  }
  const { error: updateError } = await db
    .from("meetings")
    .update({
      type: c.type,
      type_source: "llm",
      type_confidence: Math.round(c.confidence * 100) / 100,
      type_reason: c.reason,
      client_name_guess: c.client_name_guess,
      client_id: clientId,
      process_status: routing.status,
      // Only a meeting that stays processing keeps its claim.
      claimed_at: routing.proceed ? undefined : null,
    })
    .eq("id", meetingId);
  if (updateError) return { ok: false, proceed: false, status: null, type: null, confidence: null, errors: [updateError.message] };

  await logAgentRun(meetingId, "classify", "ok", meeting.process_attempts, `${c.type} (${c.confidence}) -> ${routing.status}: ${c.reason}`);
  await logPipelineEvent(meetingId, "info", "classify", `Routine classified the meeting as ${c.type} (${Math.round(c.confidence * 100)}%) -> ${routing.status}`);
  return { ok: true, proceed: routing.proceed, status: routing.status, type: c.type, confidence: c.confidence, errors: [] };
}
