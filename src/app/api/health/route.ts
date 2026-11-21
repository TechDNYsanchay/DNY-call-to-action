// GET /api/health: public, no secrets. Enough for an uptime check and the Settings > Integrations
// screen: when the cron and the webhook last spoke, how many meetings sit in each state, and how long
// the oldest 'ready' meeting has been waiting for the routine. The counts are tl;dv meetings only; phone
// calls add one `calls` block (switches and times only: no counts per call, no error text, nothing per line).

import { parseCallyzerState } from "@/lib/calls/deps";
import { parseCallsSettings } from "@/lib/calls/settings";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type ProcessStatus = Database["public"]["Enums"]["process_status"];

const STATUSES: ProcessStatus[] = ["new", "waiting_transcript", "ready", "processing", "needs_decision", "done", "failed", "skipped"];

/** A poll older than this while calls are on means the feed is stuck. */
const CALLS_POLL_FRESH_MS = 10 * 60_000;

const ageMinutes = (now: Date, iso: string | null | undefined): number | null => {
  const since = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(since) ? Math.max(0, Math.round((now.getTime() - since) / 60_000)) : null;
};

export async function GET() {
  const now = new Date();
  const headers = { "cache-control": "no-store" };
  try {
    const db = supabaseAdmin();
    const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
    const [sync, routine, webhook, failed, oldestReady, callsState, callsPaused, linesOn, oldestReadyCall, ...perStatus] = await Promise.all([
      db.from("sync_state").select("last_synced_at").eq("key", "tldv").maybeSingle(),
      db.from("sync_state").select("last_synced_at").eq("key", "routine-fire").maybeSingle(),
      db.from("webhook_events").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("meetings").select("id", { count: "exact", head: true }).eq("kind", "meeting").eq("process_status", "failed").gte("updated_at", dayAgo),
      db.from("meetings").select("updated_at").eq("kind", "meeting").eq("process_status", "ready").order("updated_at", { ascending: true }).limit(1).maybeSingle(),
      db.from("sync_state").select("last_synced_at, value").eq("key", "callyzer").maybeSingle(),
      db.from("settings").select("key, value").eq("key", "calls_paused"),
      db.from("phone_lines").select("id", { count: "exact", head: true }).eq("enabled", true),
      db.from("meetings").select("updated_at").eq("kind", "call").eq("process_status", "ready").order("updated_at", { ascending: true }).limit(1).maybeSingle(),
      ...STATUSES.map((status) => db.from("meetings").select("id", { count: "exact", head: true }).eq("kind", "meeting").eq("process_status", status)),
    ]);
    const failure = [sync, routine, webhook, failed, oldestReady, callsState, callsPaused, linesOn, oldestReadyCall, ...perStatus].find((r) => r.error)?.error;
    if (failure) throw new Error(failure.message);

    const countsByStatus = Object.fromEntries(STATUSES.map((status, i) => [status, perStatus[i].count ?? 0])) as Record<ProcessStatus, number>;
    // Calls are on when the three keys are set (never their values), calls are not paused, and a line is on.
    const paused = parseCallsSettings(callsPaused.data ?? []).paused;
    const keysSet = Boolean(process.env.CALLYZER_API_BASE && process.env.CALLYZER_API_KEY && process.env.DEEPGRAM_API_KEY);
    const callsOn = keysSet && !paused && (linesOn.count ?? 0) > 0;
    const lastPollAt = callsState.data?.last_synced_at ?? null;
    const lastPollMs = lastPollAt ? Date.parse(lastPollAt) : NaN;
    return Response.json(
      {
        ok: true,
        now: now.toISOString(),
        lastSyncAt: sync.data?.last_synced_at ?? null,
        lastWebhookAt: webhook.data?.received_at ?? null,
        // Whether a ready meeting starts the routine at once (only whether the keys are set, never their values).
        routineStartsAtOnce: Boolean(process.env.ROUTINE_FIRE_URL && process.env.ROUTINE_FIRE_TOKEN),
        lastRoutineStartAt: routine.data?.last_synced_at ?? null,
        countsByStatus,
        failed24h: failed.count ?? 0,
        oldestReadyAgeMin: ageMinutes(now, oldestReady.data?.updated_at),
        calls: {
          on: callsOn,
          paused,
          lastPollAt,
          pollOk: callsOn && Number.isFinite(lastPollMs) && now.getTime() - lastPollMs <= CALLS_POLL_FRESH_MS,
          lastTranscribedAt: parseCallyzerState(callsState.data?.value).lastTranscribedAt,
          oldestReadyAgeMin: ageMinutes(now, oldestReadyCall.data?.updated_at),
        },
      },
      { headers },
    );
  } catch (error) {
    console.error(`health: ${error instanceof Error ? error.message : String(error)}`);
    return Response.json({ ok: false, now: now.toISOString(), error: "Database not reachable" }, { status: 503, headers });
  }
}
