import "server-only";

// Starts the Call to Action routine the moment a meeting is ready, through the routine's API trigger,
// so a meeting's sheet appears a few minutes after tl;dv's transcript instead of at the next hourly
// run. Needs ROUTINE_FIRE_URL and ROUTINE_FIRE_TOKEN (the routine's Fire URL and token, made on
// claude.ai/code/routines); without them nothing happens and the hourly run picks meetings up as before.

import { optionalEnv } from "@/lib/env";
import { logEvent } from "@/lib/ingest/intake";
import { supabaseAdmin } from "@/lib/supabase/server";

const STATE_KEY = "routine-fire";
/**
 * At most one start per minute. A run started within the last minute is still booting or writing a
 * sheet, and it keeps asking for the next ready meeting until the queue is empty, so it takes a
 * meeting that turned ready meanwhile; starting another would only cost a second session.
 */
const COALESCE_MS = 60_000;
const TIMEOUT_MS = 10_000;

export type RoutineStart = "started" | "recent" | "off" | "failed";

/** Never throws: a failed start only delays the sheet until the hourly run. */
export async function startRoutine(reason: string): Promise<RoutineStart> {
  const url = optionalEnv("ROUTINE_FIRE_URL");
  const token = optionalEnv("ROUTINE_FIRE_TOKEN");
  if (!url || !token) return "off";
  try {
    if (!(await claimSlot())) return "recent";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      await releaseSlot();
      await logEvent("warn", "routine", `Couldn't start the routine (HTTP ${response.status}${detail ? `: ${detail}` : ""}); the hourly run will pick the meeting up. Reason for the start: ${reason}`);
      return "failed";
    }
    await logEvent("info", "routine", `Routine started at once: ${reason}`);
    return "started";
  } catch (error) {
    await releaseSlot().catch(() => undefined);
    await logEvent("warn", "routine", `Couldn't start the routine (${error instanceof Error ? error.message : String(error)}); the hourly run will pick the meeting up`);
    return "failed";
  }
}

/** Takes the one-per-minute slot; false when a start already happened within the minute. */
async function claimSlot(): Promise<boolean> {
  const db = supabaseAdmin();
  const now = new Date();
  const cutoff = new Date(now.getTime() - COALESCE_MS).toISOString();
  const { data, error } = await db
    .from("sync_state")
    .update({ last_synced_at: now.toISOString() })
    .eq("key", STATE_KEY)
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
    .select("key");
  if (error) throw new Error(`sync_state: ${error.message}`);
  if (data?.length) return true;
  // No row updated: either a start happened within the minute, or the row doesn't exist yet.
  const { error: insertError } = await db.from("sync_state").insert({ key: STATE_KEY, last_synced_at: now.toISOString() });
  if (!insertError) return true;
  if (insertError.code === "23505") return false;
  throw new Error(`sync_state: ${insertError.message}`);
}

/** A start that failed frees the slot, so the next ready meeting tries again at once. */
async function releaseSlot(): Promise<void> {
  await supabaseAdmin().from("sync_state").update({ last_synced_at: null }).eq("key", STATE_KEY);
}
