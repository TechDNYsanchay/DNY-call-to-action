"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { domainOf, isGenericDomain } from "@/lib/ingest/rules";
import { logPipelineEvent } from "@/lib/sheet/settings";
import { supabaseAdmin } from "@/lib/supabase/server";
import { type ActionResult, failed, ok } from "@/lib/ui/action-result";
import type { ProcessStatus } from "@/lib/ui/status";

// A person decides what a meeting is. Used by the review queue, the meeting page banner, the
// "Change type" dialog and the "Actually a client meeting" button on skipped meetings.

export type DecisionType = "client" | "sales" | "internal" | "other";

export interface DecideOptions {
  /** An existing client to attach (client meetings only). */
  clientId?: string | null;
  /** Or a new client to create by name. */
  newClientName?: string | null;
  /** Also store the external participants' domains (or personal emails) on the client. */
  rememberDomain?: boolean;
  note?: string | null;
}

const TYPES: readonly DecisionType[] = ["client", "sales", "internal", "other"];

export async function decideMeetingType(meetingId: string, type: DecisionType, opts: DecideOptions = {}): Promise<ActionResult<{ status: ProcessStatus; clientId: string | null }>> {
  try {
    const { person } = await requireUser();
    if (!TYPES.includes(type)) throw new Error("Unknown meeting type");
    const db = supabaseAdmin();
    const { data: meeting, error } = await db.from("meetings").select("id, type, client_id, process_status, transcript_ready").eq("id", meetingId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!meeting) throw new Error("This meeting no longer exists");

    let clientId: string | null = meeting.client_id;
    if (type === "client") {
      const newName = opts.newClientName?.trim().replace(/\s+/g, " ");
      if (newName) {
        const { data: created, error: cError } = await db.from("clients").insert({ name: newName, status: "active" }).select("id").single();
        if (cError) throw new Error(`Could not create the client: ${cError.message}`);
        clientId = created.id;
      } else if (opts.clientId) {
        clientId = opts.clientId;
      }
      if (opts.rememberDomain && clientId) await rememberParticipants(meetingId, clientId);
    }

    const { count } = await db.from("sheets").select("id", { count: "exact", head: true }).eq("meeting_id", meetingId);
    const hasSheet = (count ?? 0) > 0;
    const keepWaiting = meeting.process_status === "new" || meeting.process_status === "waiting_transcript";
    const status: ProcessStatus = type !== "client" ? "skipped" : hasSheet ? "done" : meeting.transcript_ready ? "ready" : keepWaiting ? meeting.process_status : "ready";
    const note = opts.note?.trim().slice(0, 500) || null;

    const { error: uError } = await db
      .from("meetings")
      .update({
        type,
        type_source: "human",
        type_confidence: 1,
        type_reason: `Marked as ${type === "client" ? "a client meeting" : type === "sales" ? "a sales meeting" : type} by ${person.full_name}${note ? `: ${note}` : ""}`,
        client_id: type === "client" ? clientId : meeting.client_id,
        process_status: status,
        claimed_at: null,
        failure_reason: null,
      })
      .eq("id", meetingId);
    if (uError) throw new Error(uError.message);

    const { error: fError } = await db.from("classification_feedback").insert({ meeting_id: meetingId, from_type: meeting.type, to_type: type, client_id: type === "client" ? clientId : null, note, person_id: person.id });
    if (fError) console.warn(`classification_feedback: ${fError.message}`);
    await logPipelineEvent(meetingId, "info", "decision", `${person.full_name} marked the meeting as ${type}; status ${status}`);

    revalidatePath("/meetings");
    revalidatePath("/review");
    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath("/", "layout");
    return ok({ status, clientId: type === "client" ? clientId : null });
  } catch (e) {
    return failed(e);
  }
}

/** Non-DNY participants: company domains go to clients.domains, personal mailboxes to contact_emails. */
async function rememberParticipants(meetingId: string, clientId: string): Promise<void> {
  const db = supabaseAdmin();
  const [{ data: participants }, { data: client }] = await Promise.all([
    db.from("participants").select("email, is_dny").eq("meeting_id", meetingId),
    db.from("clients").select("domains, contact_emails").eq("id", clientId).maybeSingle(),
  ]);
  if (!client) return;
  const domains = new Set(client.domains);
  const emails = new Set(client.contact_emails);
  for (const p of participants ?? []) {
    if (p.is_dny) continue;
    const domain = domainOf(p.email);
    if (!domain) continue;
    if (isGenericDomain(domain)) emails.add(p.email.toLowerCase());
    else domains.add(domain);
  }
  const { error } = await db.from("clients").update({ domains: [...domains], contact_emails: [...emails] }).eq("id", clientId);
  if (error) throw new Error(`Could not update the client: ${error.message}`);
}
