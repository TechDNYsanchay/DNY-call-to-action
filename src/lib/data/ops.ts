import "server-only";
import { parseSettings, type Settings } from "@/lib/ingest/settings";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseServer } from "@/lib/supabase/server";
import type { ProcessStatus } from "@/lib/ui/status";

// Settings > Integrations and status. Admin-only tables (settings, sync_state, pipeline_events,
// webhook_events) are read as the signed-in admin: RLS refuses everyone else, so the page falls back
// to "not available" rather than failing.

export type PipelineEvent = Pick<Database["public"]["Tables"]["pipeline_events"]["Row"], "id" | "meeting_id" | "level" | "step" | "message" | "created_at">;

export interface OpsData {
  settings: Settings;
  sync: { last_synced_at: string | null; locked_until: string | null } | null;
  lastWebhook: { event: string; received_at: string; tldv_meeting_id: string | null } | null;
  events: PipelineEvent[];
  countsByStatus: Record<ProcessStatus, number>;
  failedLast24h: number;
  oldestReadyAt: string | null;
}

const STATUSES: ProcessStatus[] = ["new", "waiting_transcript", "ready", "processing", "needs_decision", "done", "failed", "skipped"];

export async function getOpsData(): Promise<OpsData> {
  const db = await supabaseServer();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [settings, sync, webhook, events, failed, oldestReady, ...counts] = await Promise.all([
    db.from("settings").select("key, value"),
    db.from("sync_state").select("last_synced_at, locked_until").eq("key", "tldv").maybeSingle(),
    db.from("webhook_events").select("event, received_at, tldv_meeting_id").order("received_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("pipeline_events").select("id, meeting_id, level, step, message, created_at").order("created_at", { ascending: false }).limit(20),
    db.from("meetings").select("id", { count: "exact", head: true }).eq("process_status", "failed").gte("updated_at", since),
    db.from("meetings").select("updated_at").eq("process_status", "ready").order("updated_at", { ascending: true }).limit(1).maybeSingle(),
    ...STATUSES.map((s) => db.from("meetings").select("id", { count: "exact", head: true }).eq("process_status", s)),
  ]);
  const countsByStatus = Object.fromEntries(STATUSES.map((s, i) => [s, counts[i].count ?? 0])) as Record<ProcessStatus, number>;
  return {
    settings: parseSettings(settings.data ?? []),
    sync: sync.data ?? null,
    lastWebhook: webhook.data ?? null,
    events: events.data ?? [],
    countsByStatus,
    failedLast24h: failed.count ?? 0,
    oldestReadyAt: oldestReady.data?.updated_at ?? null,
  };
}
