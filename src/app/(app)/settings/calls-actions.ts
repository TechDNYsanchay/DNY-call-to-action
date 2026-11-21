"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin } from "@/lib/auth/require-user";
import { callsDb } from "@/lib/calls/db";
import { drainStorageDeletions } from "@/lib/calls/purge";
import { istDayStartIso, NIGHT_POLL_CHOICES, REREAD_MAX_DAYS, ymdMinus } from "@/lib/calls/schedule";
import { CALLS_BOUNDS } from "@/lib/calls/settings";
import { istDate } from "@/lib/format";
import { toE164Strict } from "@/lib/phone";
import { logPipelineEvent } from "@/lib/sheet/settings";
import type { Json } from "@/lib/supabase/database.types";
import { supabaseAdmin } from "@/lib/supabase/server";
import { type ActionResult, failed, ok } from "@/lib/ui/action-result";

// Settings > Phone calls (admins): the switch, the lines (on and off, a label, the people who use each
// phone), the numbers and limits, a day to read again from Callyzer, and failed copies back in the queue.
// Switching calls or a line on needs the admin to confirm the people on those phones have been told.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOLD = "Confirm that the people who use these phones have been told their calls are recorded and analysed";

async function writeSetting(key: string, value: Json): Promise<void> {
  const { error } = await supabaseAdmin().from("settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

function revalidateCalls() {
  revalidatePath("/settings");
  revalidatePath("/calls");
  // The nav shows Calls once a line is on.
  revalidatePath("/", "layout");
}

const lineName = async (id: string): Promise<string> => {
  const { data } = await supabaseAdmin().from("phone_lines").select("label, callyzer_name").eq("id", id).maybeSingle();
  return data?.label ?? data?.callyzer_name ?? "a line";
};

/** Pauses or resumes the whole calls feed. Resuming switches on the initial lines when Callyzer first reports them. */
export async function setCallsPaused(paused: boolean, consent?: boolean): Promise<ActionResult> {
  try {
    const { person } = await requireAdmin();
    if (!paused && consent !== true) throw new Error(TOLD);
    await writeSetting("calls_paused", paused);
    await logPipelineEvent(null, "warn", "settings", `${person.full_name} ${paused ? "paused" : "resumed"} phone calls`);
    revalidateCalls();
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** Switches a line on: its calls are analysed from this moment, never before it. */
export async function setLineEnabled(id: string, on: true, consent: boolean): Promise<ActionResult> {
  try {
    const { person } = await requireAdmin();
    if (on !== true || !UUID.test(id)) throw new Error("Unknown line");
    if (consent !== true) throw new Error("Confirm that the people who use this phone know its calls are recorded, transcribed and analysed");
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin().from("phone_lines").update({ enabled: true, enabled_at: now, enabled_by: person.id, analyse_from: now }).eq("id", id).eq("enabled", false).select("id");
    if (error) throw new Error(error.message);
    if (data?.length) await logPipelineEvent(null, "warn", "settings", `${person.full_name} switched on the phone line ${await lineName(id)}; its calls are analysed from now`);
    revalidateCalls();
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** How many of the line's calls are not yet confirmed as work calls: switching it off deletes those. */
export async function previewLineOff(id: string): Promise<ActionResult<{ undecided: number }>> {
  try {
    await requireAdmin();
    if (!UUID.test(id)) throw new Error("Unknown line");
    const { count, error } = await supabaseAdmin()
      .from("phone_calls")
      .select("meeting_id, meeting:meetings!inner(type)", { count: "exact", head: true })
      .eq("line_id", id)
      .is("purged_at", null)
      .not("meeting.type", "in", "(client,vendor)");
    if (error) throw new Error(error.message);
    return ok({ undecided: count ?? 0 });
  } catch (e) {
    return failed(e);
  }
}

/** Switches a line off: its queued calls are dropped and its undecided calls deleted; client and vendor calls stay. */
export async function switchLineOff(id: string): Promise<ActionResult<{ dropped: number; purged: number }>> {
  try {
    const { person } = await requireAdmin();
    if (!UUID.test(id)) throw new Error("Unknown line");
    const { data, error } = await supabaseAdmin().rpc("switch_line_off", { p_line_id: id });
    if (error) throw new Error(error.message.includes("line_not_found") ? "This line no longer exists" : error.message);
    const result = { dropped: data?.[0]?.dropped ?? 0, purged: data?.[0]?.purged ?? 0 };
    await logPipelineEvent(null, "warn", "settings", `${person.full_name} switched off the phone line ${await lineName(id)}; ${result.purged} undecided call${result.purged === 1 ? "" : "s"} deleted`);
    // The deleted calls' recordings leave the bucket now; the next calls run retries any that did not.
    after(() => drainStorageDeletions(callsDb(), { limit: 50 }).catch(() => undefined));
    revalidateCalls();
    return ok(result);
  } catch (e) {
    return failed(e);
  }
}

/** The name people see for a line ("Supply desk"); empty goes back to the automatic name. */
export async function setLineLabel(id: string, label: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!UUID.test(id)) throw new Error("Unknown line");
    const clean = label.trim().replace(/\s+/g, " ");
    if (clean.length > 60) throw new Error("Keep the name under 60 characters");
    const { error } = await supabaseAdmin().from("phone_lines").update({ label: clean || null }).eq("id", id);
    if (error) throw new Error(error.message);
    revalidateCalls();
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** The people who use a line: they see its undecided calls, may decide them, and its DNY actions can reach them. */
export async function setLineMembers(id: string, personIds: string[]): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!UUID.test(id)) throw new Error("Unknown line");
    const wanted = [...new Set(personIds)].filter((p) => UUID.test(p));
    const db = supabaseAdmin();
    if (wanted.length) {
      const { data: people, error } = await db.from("people").select("id").in("id", wanted).eq("active", true);
      if (error) throw new Error(error.message);
      if ((people ?? []).length !== wanted.length) throw new Error("Someone in the list is no longer on the team");
    }
    const { data: current, error: cError } = await db.from("phone_line_members").select("person_id").eq("line_id", id);
    if (cError) throw new Error(cError.message);
    const have = new Set((current ?? []).map((m) => m.person_id));
    const remove = [...have].filter((p) => !wanted.includes(p));
    const add = wanted.filter((p) => !have.has(p));
    if (remove.length) {
      const { error } = await db.from("phone_line_members").delete().eq("line_id", id).in("person_id", remove);
      if (error) throw new Error(error.message);
    }
    if (add.length) {
      const { error } = await db.from("phone_line_members").upsert(add.map((person_id) => ({ line_id: id, person_id })));
      if (error) throw new Error(error.message);
    }
    revalidateCalls();
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** The numbers an admin can set, with their bounds; night polling takes one of its choices. */
const NUMBER_SETTINGS = {
  calls_min_duration_sec: { bounds: CALLS_BOUNDS.minDurationSec, unit: "seconds" },
  calls_max_minutes: { bounds: CALLS_BOUNDS.maxMinutes, unit: "minutes" },
  calls_max_audio_minutes_per_day: { bounds: CALLS_BOUNDS.maxAudioMinutesPerDay, unit: "minutes" },
  calls_claim_timeout_minutes: { bounds: CALLS_BOUNDS.claimTimeoutMinutes, unit: "minutes" },
  calls_decision_hours: { bounds: CALLS_BOUNDS.decisionHours, unit: "hours" },
  calls_night_poll_minutes: { bounds: null, unit: "minutes" },
} as const;

export type CallsNumberSetting = keyof typeof NUMBER_SETTINGS;

export async function setCallsNumberSetting(key: CallsNumberSetting, value: number): Promise<ActionResult> {
  try {
    const { person } = await requireAdmin();
    const spec = NUMBER_SETTINGS[key];
    if (!spec) throw new Error("Unknown setting");
    const n = Number(value);
    if (!Number.isInteger(n)) throw new Error("Enter a whole number");
    if (spec.bounds && (n < spec.bounds[0] || n > spec.bounds[1])) throw new Error(`Choose between ${spec.bounds[0]} and ${spec.bounds[1]} ${spec.unit}`);
    if (!spec.bounds && !(NIGHT_POLL_CHOICES as readonly number[]).includes(n)) throw new Error("Choose one of the listed intervals");
    await writeSetting(key, n);
    await logPipelineEvent(null, "info", "settings", `${person.full_name} set ${key} to ${n}`);
    revalidateCalls();
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** Whether Deepgram may use the recordings to improve its models (off by default: mip_opt_out). */
export async function setDeepgramOptOut(optOut: boolean): Promise<ActionResult> {
  try {
    const { person } = await requireAdmin();
    await writeSetting("calls_deepgram_mip_opt_out", optOut === true);
    await logPipelineEvent(null, "warn", "settings", `${person.full_name} ${optOut ? "opted recordings out of" : "allowed"} Deepgram's model improvement`);
    revalidatePath("/settings");
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** Other DNY numbers, one per line: calls with them count as internal and are never analysed. Returns them as stored (E.164). */
export async function setDnyNumbers(text: string): Promise<ActionResult<{ count: number; numbers: string[] }>> {
  try {
    const { person } = await requireAdmin();
    const numbers: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const e164 = toE164Strict("91", line);
      if (!e164) throw new Error(`‘${line.slice(0, 40)}’ is not a full phone number`);
      if (!numbers.includes(e164)) numbers.push(e164);
    }
    if (numbers.length > 200) throw new Error("Keep the list under 200 numbers");
    await writeSetting("calls_dny_numbers", numbers);
    await logPipelineEvent(null, "info", "settings", `${person.full_name} set ${numbers.length} other DNY number${numbers.length === 1 ? "" : "s"}`);
    revalidatePath("/settings");
    return ok({ count: numbers.length, numbers });
  } catch (e) {
    return failed(e);
  }
}

/** Reads one day (up to 14 days back) from Callyzer again on the next runs, for recordings that arrived late. */
export async function requestReread(ymd: string): Promise<ActionResult> {
  try {
    const { person } = await requireAdmin();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error("Choose a date");
    const today = istDate(new Date());
    const earliest = ymdMinus(today, REREAD_MAX_DAYS);
    if (ymd > today) throw new Error("Choose today or a day before it");
    if (ymd < earliest) throw new Error(`Callyzer is read again for the last ${REREAD_MAX_DAYS} days only`);
    const { error } = await supabaseAdmin().from("call_reread_requests").upsert({ day: ymd, requested_by: person.id, requested_at: new Date().toISOString(), done_at: null });
    if (error) throw new Error(error.message);
    await logPipelineEvent(null, "info", "settings", `${person.full_name} asked Callyzer for ${ymd} again`);
    revalidatePath("/settings");
    return ok();
  } catch (e) {
    return failed(e);
  }
}

/** Today's and yesterday's failed copies go back in the queue with fresh attempts. */
export async function retryFailedCopies(): Promise<ActionResult<{ count: number }>> {
  try {
    const { person } = await requireAdmin();
    const since = new Date(Date.parse(istDayStartIso(new Date())) - 86_400_000).toISOString();
    const { data, error } = await supabaseAdmin()
      .from("call_log")
      .update({ status: "pending", attempts: 0, next_try_at: null, first_error_at: null, error: null, error_kind: null, started_at: null })
      .eq("status", "failed")
      .gte("call_started_at", since)
      .select("callyzer_id");
    if (error) throw new Error(error.message);
    const count = data?.length ?? 0;
    if (count) await logPipelineEvent(null, "info", "settings", `${person.full_name} put ${count} failed recording cop${count === 1 ? "y" : "ies"} back in the queue`);
    revalidateCalls();
    return ok({ count });
  } catch (e) {
    return failed(e);
  }
}
