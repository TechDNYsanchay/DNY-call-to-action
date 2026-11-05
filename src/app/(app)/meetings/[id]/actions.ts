"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth/require-user";
import { logPipelineEvent } from "@/lib/sheet/settings";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseAdmin } from "@/lib/supabase/server";
import { type ActionResult, failed, ok } from "@/lib/ui/action-result";

// Edits to a sheet's action items and the admin re-run. Every action checks the person first and
// writes with the service role; the pages involved are revalidated so the next render is fresh.

type ItemUpdate = Database["public"]["Tables"]["action_items"]["Update"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function updateItem(itemId: string, patch: ItemUpdate): Promise<{ meeting_id: string }> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("action_items").update(patch).eq("id", itemId).select("meeting_id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This item no longer exists");
  return data;
}

function revalidateItemPages(meetingId: string) {
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath("/mine");
  revalidatePath("/clients/[id]", "page");
  revalidatePath("/meetings");
}

export async function setItemDone(itemId: string, done: boolean): Promise<ActionResult> {
  try {
    const { person } = await requireUser();
    const { meeting_id } = await updateItem(itemId, done ? { status: "done", done_at: new Date().toISOString(), done_by: person.id } : { status: "open", done_at: null, done_by: null });
    revalidateItemPages(meeting_id);
    return ok();
  } catch (e) {
    return failed(e);
  }
}

export interface OwnerInput {
  name: string | null;
  email: string | null;
}

export async function assignItem(itemId: string, owner: OwnerInput | null): Promise<ActionResult> {
  try {
    const { person } = await requireUser();
    const name = owner?.name?.trim().slice(0, 120) || null;
    const email = owner?.email?.trim().toLowerCase().slice(0, 200) || null;
    const { meeting_id } = await updateItem(itemId, { owner_name: name, owner_email: email, owner_basis: name || email ? "assigned_by_person" : "not_stated", edited_by: person.id, edited_at: new Date().toISOString() });
    revalidateItemPages(meeting_id);
    return ok();
  } catch (e) {
    return failed(e);
  }
}

export async function setItemDue(itemId: string, date: string | null): Promise<ActionResult> {
  try {
    const { person } = await requireUser();
    if (date && !DATE.test(date)) throw new Error("The date must look like 2026-11-07");
    const { meeting_id } = await updateItem(itemId, { due_date: date, due_kind: date ? "explicit_date" : "none_stated", edited_by: person.id, edited_at: new Date().toISOString() });
    revalidateItemPages(meeting_id);
    return ok();
  } catch (e) {
    return failed(e);
  }
}

export async function editItem(itemId: string, input: { title: string; details: string }): Promise<ActionResult> {
  try {
    const { person } = await requireUser();
    const title = input.title.trim().replace(/\s+/g, " ");
    const details = input.details.trim();
    if (title.length < 3) throw new Error("The title needs at least three characters");
    if (title.length > 140) throw new Error("Keep the title under 140 characters");
    if (details.length > 1000) throw new Error("Keep the details under 1000 characters");
    const db = supabaseAdmin();
    const { data: before, error } = await db.from("action_items").select("meeting_id, title, details").eq("id", itemId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!before) throw new Error("This item no longer exists");
    await updateItem(itemId, { title, details, edited_by: person.id, edited_at: new Date().toISOString() });
    // The original is kept so the edit is reviewable later.
    const { error: fError } = await db.from("item_feedback").insert({ action_item_id: itemId, verdict: "edit", edited: { title, details, previous: { title: before.title, details: before.details } }, person_id: person.id });
    if (fError) console.warn(`item_feedback: ${fError.message}`);
    revalidateItemPages(before.meeting_id);
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** DNY <-> client; "both" and "unclear" become DNY-owed, the side that can act here. */
export async function moveItemLane(itemId: string): Promise<ActionResult> {
  try {
    const { person } = await requireUser();
    const db = supabaseAdmin();
    const { data, error } = await db.from("action_items").select("owed_by").eq("id", itemId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("This item no longer exists");
    const next = data.owed_by === "dny" ? "client" : "dny";
    const { meeting_id } = await updateItem(itemId, { owed_by: next, edited_by: person.id, edited_at: new Date().toISOString() });
    revalidateItemPages(meeting_id);
    return ok();
  } catch (e) {
    return failed(e);
  }
}

export type DismissReason = "not_said" | "duplicate" | "too_vague" | "other";
const REASONS: readonly DismissReason[] = ["not_said", "duplicate", "too_vague", "other"];

export async function dismissItem(itemId: string, reason: DismissReason, note?: string): Promise<ActionResult> {
  try {
    const { person } = await requireUser();
    if (!REASONS.includes(reason)) throw new Error("Pick a reason");
    const { meeting_id } = await updateItem(itemId, { status: "dropped", edited_by: person.id, edited_at: new Date().toISOString() });
    const db = supabaseAdmin();
    const { error } = await db.from("item_feedback").insert({ action_item_id: itemId, verdict: "dismiss", reason_code: reason, edited: note?.trim() ? { note: note.trim().slice(0, 500) } : null, person_id: person.id });
    if (error) console.warn(`item_feedback: ${error.message}`);
    revalidateItemPages(meeting_id);
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** Undo a dismissal (the toast's Undo): the row reopens. */
export async function restoreItem(itemId: string): Promise<ActionResult> {
  try {
    await requireUser();
    const { meeting_id } = await updateItem(itemId, { status: "open" });
    revalidateItemPages(meeting_id);
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/**
 * Admin: put a client meeting back in the queue. The next routine run writes a new sheet version;
 * the old one is kept (status superseded) and edited rows survive by their item key.
 */
export async function rerunMeeting(meetingId: string): Promise<ActionResult> {
  try {
    const { person } = await requireAdmin();
    const db = supabaseAdmin();
    const { data: meeting, error } = await db.from("meetings").select("type, transcript_ready, process_status").eq("id", meetingId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!meeting) throw new Error("This meeting no longer exists");
    if (meeting.type !== "client") throw new Error("Only client meetings are analysed. Change the type first.");
    if (!meeting.transcript_ready) throw new Error("The transcript has not arrived yet, so there is nothing to analyse");
    if (meeting.process_status === "processing") throw new Error("A run is working on this meeting right now");
    const { error: uError } = await db.from("meetings").update({ process_status: "ready", claimed_at: null, failure_reason: null }).eq("id", meetingId);
    if (uError) throw new Error(uError.message);
    await logPipelineEvent(meetingId, "info", "rerun", `${person.full_name} queued the meeting for another run`);
    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath("/meetings");
    return ok();
  } catch (e) {
    return failed(e);
  }
}
