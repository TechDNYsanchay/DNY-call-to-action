"use server";

import { revalidatePath } from "next/cache";
import { addPerson, deactivatePerson, reactivatePerson } from "@/lib/auth/people-admin";
import { requireAdmin } from "@/lib/auth/require-user";
import { backfillMeetings, MAX_BACKFILL_DAYS } from "@/lib/ingest/backfill";
import { replayMeeting } from "@/lib/ingest/replay";
import { logPipelineEvent } from "@/lib/sheet/settings";
import { supabaseAdmin } from "@/lib/supabase/server";
import { type ActionResult, failed, ok } from "@/lib/ui/action-result";

// Admin-only settings actions: the team list, the pipeline switch, replay and backfill. Every
// function runs requireAdmin() first; the people helpers throw plain-English messages shown as is.

export async function addPersonAction(input: { email: string; fullName: string; role: string; dept: string }): Promise<ActionResult> {
  try {
    await requireAdmin();
    const role = input.role === "admin" ? "admin" : "member";
    await addPerson({ email: input.email, fullName: input.fullName, role, dept: input.dept || null });
    revalidatePath("/settings");
    return ok();
  } catch (e) {
    return failed(e);
  }
}

export async function setPersonActive(email: string, active: boolean): Promise<ActionResult> {
  try {
    const { person } = await requireAdmin();
    if (!active && email.trim().toLowerCase() === person.email) throw new Error("You cannot deactivate your own account");
    if (active) await reactivatePerson(email);
    else await deactivatePerson(email);
    revalidatePath("/settings");
    return ok();
  } catch (e) {
    return failed(e);
  }
}

export async function setPipelinePaused(paused: boolean): Promise<ActionResult> {
  try {
    const { person } = await requireAdmin();
    const db = supabaseAdmin();
    const { error } = await db.from("settings").upsert({ key: "pipeline_paused", value: paused, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    await logPipelineEvent(null, "warn", "settings", `${person.full_name} ${paused ? "paused" : "resumed"} the pipeline`);
    revalidatePath("/settings");
    return ok();
  } catch (e) {
    return failed(e);
  }
}

export async function replayAction(tldvMeetingId: string): Promise<ActionResult<{ meetingId: string; status: string }>> {
  try {
    await requireAdmin();
    const result = await replayMeeting(tldvMeetingId);
    revalidatePath("/meetings");
    revalidatePath("/settings");
    return ok(result);
  } catch (e) {
    return failed(e);
  }
}

export async function backfillAction(days: number): Promise<ActionResult<{ seen: number; created: number }>> {
  try {
    await requireAdmin();
    const span = Math.floor(Number(days));
    if (!Number.isFinite(span) || span < 1 || span > MAX_BACKFILL_DAYS) throw new Error(`Choose between 1 and ${MAX_BACKFILL_DAYS} days`);
    const result = await backfillMeetings(span);
    revalidatePath("/meetings");
    revalidatePath("/settings");
    return ok(result);
  } catch (e) {
    return failed(e);
  }
}
