"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin, requireUser } from "@/lib/auth/require-user";
import { callsDb } from "@/lib/calls/db";
import { purgeCall } from "@/lib/calls/purge";
import { startRoutine } from "@/lib/routine";
import { logPipelineEvent } from "@/lib/sheet/settings";
import { supabaseAdmin } from "@/lib/supabase/server";
import { type ActionResult, failed, ok } from "@/lib/ui/action-result";
import { isBusinessType } from "@/lib/ui/audio-access";
import type { MeetingType, ProcessStatus } from "@/lib/ui/status";

// What people can do on a call page. Every action checks the person first (requireUser or requireAdmin),
// then who they are to this call (an admin, or someone on its phone line), then writes with the secret key
// through the database's own functions, so the checks that matter (not deleted, not claimed, a person's
// label wins) also hold inside the write. A deleted call refuses everything.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURGED = "This call was deleted as not a work call";
const GONE = "This call no longer exists";

interface CallState {
  type: MeetingType;
  processStatus: ProcessStatus;
  transcriptReady: boolean;
  clientId: string | null;
  clientNameGuess: string | null;
  purgedAt: string | null;
  sttStatus: string;
  recordingStatus: string;
  isLineMember: boolean;
}

/** The call's state and whether this person is on its line, read fresh with the secret key. */
async function loadCall(id: string, personId: string): Promise<CallState> {
  if (!UUID.test(id)) throw new Error(GONE);
  const db = supabaseAdmin();
  const [{ data, error }, lines] = await Promise.all([
    db.from("meetings").select("kind, type, process_status, transcript_ready, client_id, client_name_guess, call:phone_calls(purged_at, line_id, stt_status, recording_status)").eq("id", id).maybeSingle(),
    db.from("phone_line_members").select("line_id").eq("person_id", personId),
  ]);
  if (error) throw new Error(error.message);
  if (lines.error) throw new Error(lines.error.message);
  if (!data || data.kind !== "call" || !data.call) throw new Error(GONE);
  const lineId = data.call.line_id;
  return {
    type: data.type,
    processStatus: data.process_status,
    transcriptReady: data.transcript_ready,
    clientId: data.client_id,
    clientNameGuess: data.client_name_guess,
    purgedAt: data.call.purged_at,
    sttStatus: data.call.stt_status,
    recordingStatus: data.call.recording_status,
    isLineMember: (lines.data ?? []).some((m) => m.line_id === lineId),
  };
}

/** The database's exception codes, in words. */
function rpcError(message: string): Error {
  if (message.includes("call_purged")) return new Error(PURGED);
  if (message.includes("call_not_found")) return new Error(GONE);
  return new Error(message);
}

function revalidateCall(id: string, opts: { nav?: boolean; items?: boolean } = {}) {
  revalidatePath(`/calls/${id}`);
  revalidatePath("/calls");
  if (opts.items) {
    revalidatePath("/mine");
    revalidatePath("/clients/[id]", "page");
  }
  // The nav's decisions badge.
  if (opts.nav) revalidatePath("/", "layout");
}

const ownCall = (isAdmin: boolean, call: CallState) => isAdmin || call.isLineMember;

/**
 * An admin or the line's people say an undecided call is a client or vendor call; it is analysed from there.
 * A client or vendor call in "Needs your decision" is decided the same way (none arises today: hold_call undoes
 * a label the routine gave on an earlier run); any other client or vendor call already is one. `clientId`
 * undefined keeps the call's client link; null leaves it without a client.
 */
export async function decideCall(id: string, type: "client" | "vendor", clientId?: string | null): Promise<ActionResult<{ status: ProcessStatus }>> {
  try {
    const { person, isAdmin } = await requireUser();
    if (type !== "client" && type !== "vendor") throw new Error("Choose a client call or a vendor call");
    if (clientId && !UUID.test(clientId)) throw new Error("Unknown client");
    const call = await loadCall(id, person.id);
    if (call.purgedAt) throw new Error(PURGED);
    if (!ownCall(isAdmin, call)) throw new Error("Only an admin or the people on this phone line can decide what this call is");
    if (isBusinessType(call.type) && call.processStatus !== "needs_decision") throw new Error(`This is already a ${call.type} call`);
    const { data, error } = await supabaseAdmin().rpc("decide_call", {
      p_meeting_id: id,
      p_type: type,
      // The generated types say string; the function takes null for "no client".
      p_client_id: (type === "client" ? (clientId === undefined ? call.clientId : clientId) : null) as string,
      p_by_name: person.full_name,
    });
    if (error) throw rpcError(error.message);
    const status = data as ProcessStatus;
    await logPipelineEvent(id, "info", "decision", `${person.full_name} marked a call as a ${type} call; status ${status}`);
    if (status === "ready") after(() => startRoutine(`${person.full_name} marked a call as a ${type} call`));
    revalidateCall(id, { nav: true });
    return ok({ status });
  } catch (e) {
    return failed(e);
  }
}

/**
 * Deletes the call's recording, transcript, sheet and actions for good, keeping a stub (masked number, line,
 * time, a fixed reason naming the person). Admins always; the line's people only while it is not yet a
 * client or vendor call.
 */
export async function markCallNotWork(id: string): Promise<ActionResult> {
  try {
    const { person, isAdmin } = await requireUser();
    const call = await loadCall(id, person.id);
    if (call.purgedAt) throw new Error(PURGED);
    const business = isBusinessType(call.type);
    if (!isAdmin && !(call.isLineMember && !business)) {
      throw new Error(business ? "Only an admin can delete a client or vendor call" : "Only an admin or the people on this phone line can delete this call");
    }
    const result = await purgeCall(callsDb(), id, "not_business", { by: "person", byName: person.full_name });
    if (!result.purged) throw new Error(PURGED);
    await logPipelineEvent(id, "warn", "decision", `${person.full_name} marked a call as not a work call; its recording, transcript${business ? ", sheet and actions" : ""} were deleted`);
    revalidateCall(id, { nav: true, items: business });
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** Client call <-> vendor call, for any active person, once the call is business. The person's word is final. */
export async function setCallType(id: string, type: "client" | "vendor"): Promise<ActionResult> {
  try {
    const { person } = await requireUser();
    if (type !== "client" && type !== "vendor") throw new Error("Choose a client call or a vendor call");
    const call = await loadCall(id, person.id);
    if (call.purgedAt) throw new Error(PURGED);
    if (!isBusinessType(call.type)) throw new Error("Decide first whether this is a work call");
    if (call.type === type) return ok();
    const { error } = await supabaseAdmin().rpc("mark_call_business", {
      p_meeting_id: id,
      p_type: type,
      p_source: "human",
      p_confidence: 1,
      p_reason: `Changed to a ${type} call by ${person.full_name}`,
      p_client_id: (type === "client" ? call.clientId : null) as string,
      // Kept, so the title and the routine's guess survive the change.
      p_client_name_guess: call.clientNameGuess as string,
    });
    if (error) throw rpcError(error.message);
    revalidateCall(id);
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** Links a client call to a client (or unlinks it); any active person. */
export async function linkCallClient(id: string, clientId: string | null): Promise<ActionResult> {
  try {
    const { person } = await requireUser();
    if (clientId && !UUID.test(clientId)) throw new Error("Unknown client");
    const call = await loadCall(id, person.id);
    if (call.purgedAt) throw new Error(PURGED);
    if (call.type !== "client") throw new Error("Only a client call links to a client");
    if (call.clientId === clientId) return ok();
    let reason = `Unlinked from its client by ${person.full_name}`;
    if (clientId) {
      const { data: client, error } = await supabaseAdmin().from("clients").select("name").eq("id", clientId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!client) throw new Error("That client no longer exists");
      reason = `Linked to ${client.name} by ${person.full_name}`;
    }
    const { error } = await supabaseAdmin().rpc("mark_call_business", {
      p_meeting_id: id,
      p_type: "client",
      p_source: "human",
      p_confidence: 1,
      p_reason: reason,
      p_client_id: clientId as string,
      p_client_name_guess: call.clientNameGuess as string,
    });
    if (error) throw rpcError(error.message);
    revalidateCall(id, { items: true });
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** A failed transcription with its recording still stored and no transcript: the next calls run (within 2 min) tries again. */
export async function retryCallTranscription(id: string): Promise<ActionResult> {
  try {
    const { person, isAdmin } = await requireUser();
    const call = await loadCall(id, person.id);
    if (call.purgedAt) throw new Error(PURGED);
    if (!ownCall(isAdmin, call)) throw new Error("Only an admin or the people on this phone line can retry this call");
    if (call.sttStatus !== "failed" || call.transcriptReady || call.recordingStatus !== "stored") throw new Error("Only a failed transcription whose recording is still stored can be retried");
    const { data, error } = await supabaseAdmin().rpc("retry_call_transcription", { p_meeting_id: id });
    if (error) throw rpcError(error.message);
    if (!data) throw new Error("This call changed meanwhile; reload the page");
    await logPipelineEvent(id, "info", "retry", `${person.full_name} asked for a call's transcription to be retried`);
    revalidateCall(id);
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** Puts a call back in the routine's queue from `from` (failed with a transcript, or a finished sheet for a re-run). */
async function requeue(id: string, from: "failed" | "done"): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("meetings")
    .update({ process_status: "ready", process_attempts: 0, failure_reason: null, claimed_at: null, claim_token: null })
    .eq("id", id)
    .eq("kind", "call")
    .eq("process_status", from)
    .eq("transcript_ready", true)
    .select("id");
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

/** A call that failed after its transcript: analysed again by the routine, started at once. */
export async function retryCallAnalysis(id: string): Promise<ActionResult> {
  try {
    const { person, isAdmin } = await requireUser();
    const call = await loadCall(id, person.id);
    if (call.purgedAt) throw new Error(PURGED);
    if (!ownCall(isAdmin, call)) throw new Error("Only an admin or the people on this phone line can retry this call");
    if (call.processStatus !== "failed" || !call.transcriptReady) throw new Error("Only a failed call with a transcript can be analysed again");
    if (!(await requeue(id, "failed"))) throw new Error("This call changed meanwhile; reload the page");
    await logPipelineEvent(id, "info", "retry", `${person.full_name} queued a call to be analysed again`);
    after(() => startRoutine(`${person.full_name} asked for a call to be analysed again`));
    revalidateCall(id, { nav: true });
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** Admin: a finished client or vendor call gets a new sheet version; edited items survive by their key. */
export async function rerunCall(id: string): Promise<ActionResult> {
  try {
    const { person } = await requireAdmin();
    const call = await loadCall(id, person.id);
    if (call.purgedAt) throw new Error(PURGED);
    if (!isBusinessType(call.type)) throw new Error("Only client and vendor calls get a sheet");
    if (call.processStatus !== "done" || !call.transcriptReady) throw new Error(call.processStatus === "processing" ? "A run is working on this call right now" : "Only a call with a finished sheet can be run again");
    if (!(await requeue(id, "done"))) throw new Error("This call changed meanwhile; reload the page");
    await logPipelineEvent(id, "info", "rerun", `${person.full_name} queued a call for another run`);
    after(() => startRoutine(`${person.full_name} asked for a call to be run again`));
    revalidateCall(id);
    return ok();
  } catch (e) {
    return failed(e);
  }
}
