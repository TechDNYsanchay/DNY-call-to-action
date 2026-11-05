// GET /api/health: public, no secrets. Enough for an uptime check and the Settings > Integrations
// screen: when the cron and the webhook last spoke, how many meetings sit in each state, and how long
// the oldest 'ready' meeting has been waiting for the routine.

import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type ProcessStatus = Database["public"]["Enums"]["process_status"];

const STATUSES: ProcessStatus[] = ["new", "waiting_transcript", "ready", "processing", "needs_decision", "done", "failed", "skipped"];

export async function GET() {
  const now = new Date();
  const headers = { "cache-control": "no-store" };
  try {
    const db = supabaseAdmin();
    const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
    const [sync, webhook, failed, oldestReady, ...perStatus] = await Promise.all([
      db.from("sync_state").select("last_synced_at").eq("key", "tldv").maybeSingle(),
      db.from("webhook_events").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("meetings").select("id", { count: "exact", head: true }).eq("process_status", "failed").gte("updated_at", dayAgo),
      db.from("meetings").select("updated_at").eq("process_status", "ready").order("updated_at", { ascending: true }).limit(1).maybeSingle(),
      ...STATUSES.map((status) => db.from("meetings").select("id", { count: "exact", head: true }).eq("process_status", status)),
    ]);
    const failure = [sync, webhook, failed, oldestReady, ...perStatus].find((r) => r.error)?.error;
    if (failure) throw new Error(failure.message);

    const countsByStatus = Object.fromEntries(STATUSES.map((status, i) => [status, perStatus[i].count ?? 0])) as Record<ProcessStatus, number>;
    const readySince = oldestReady.data?.updated_at ? Date.parse(oldestReady.data.updated_at) : null;
    return Response.json(
      {
        ok: true,
        now: now.toISOString(),
        lastSyncAt: sync.data?.last_synced_at ?? null,
        lastWebhookAt: webhook.data?.received_at ?? null,
        countsByStatus,
        failed24h: failed.count ?? 0,
        oldestReadyAgeMin: readySince ? Math.max(0, Math.round((now.getTime() - readySince) / 60_000)) : null,
      },
      { headers },
    );
  } catch (error) {
    console.error(`health: ${error instanceof Error ? error.message : String(error)}`);
    return Response.json({ ok: false, now: now.toISOString(), error: "Database not reachable" }, { status: 503, headers });
  }
}
