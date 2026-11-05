// GET /api/cron/retention: nightly (vercel.json, 03:00 IST) with "Authorization: Bearer CRON_SECRET".
// Trims bookkeeping tables and, for meetings older than settings.retention_months, drops the
// transcript text and the raw tl;dv payload. Sheets and action items are kept: they are the record.

import { optionalEnv } from "@/lib/env";
import { logEvent } from "@/lib/ingest/intake";
import { retentionCutoff } from "@/lib/ingest/retention";
import { readSettings } from "@/lib/ingest/settings";
import { supabaseAdmin } from "@/lib/supabase/server";
import { presentedBearer, secretMatches } from "@/lib/webhooks";

export const maxDuration = 300;

const WEBHOOK_EVENTS_DAYS = 30;
const PIPELINE_EVENTS_DAYS = 90;
const CHUNK = 200;

export async function GET(request: Request) {
  if (!secretMatches(presentedBearer(request), optionalEnv("CRON_SECRET"))) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const now = new Date();
  const errors: string[] = [];

  const { count: webhookEvents, error: wError } = await db
    .from("webhook_events")
    .delete({ count: "exact" })
    .lt("received_at", new Date(now.getTime() - WEBHOOK_EVENTS_DAYS * 86_400_000).toISOString());
  if (wError) errors.push(`webhook_events: ${wError.message}`);

  const { count: pipelineEvents, error: pError } = await db
    .from("pipeline_events")
    .delete({ count: "exact" })
    .lt("created_at", new Date(now.getTime() - PIPELINE_EVENTS_DAYS * 86_400_000).toISOString());
  if (pError) errors.push(`pipeline_events: ${pError.message}`);

  // raw = null marks a meeting as already trimmed, so each one is handled once.
  const settings = await readSettings(db);
  const cutoff = retentionCutoff(settings.retention_months, now).toISOString();
  const { data: old, error: oError } = await db.from("meetings").select("id").lt("happened_at", cutoff).not("raw", "is", null).limit(5000);
  if (oError) errors.push(`meetings read: ${oError.message}`);
  let trimmed = 0;
  const ids = (old ?? []).map((m) => m.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { error: tError } = await db.from("transcripts").update({ turns: [] }).in("meeting_id", chunk);
    if (tError) {
      errors.push(`transcripts: ${tError.message}`);
      break;
    }
    const { error: mError } = await db.from("meetings").update({ raw: null }).in("id", chunk);
    if (mError) {
      errors.push(`meetings: ${mError.message}`);
      break;
    }
    trimmed += chunk.length;
  }

  const summary = `Retention: ${webhookEvents ?? 0} webhook events and ${pipelineEvents ?? 0} log lines deleted, ${trimmed} meetings older than ${settings.retention_months} months trimmed${errors.length ? `, ${errors.length} errors` : ""}`;
  await logEvent(errors.length ? "warn" : "info", "retention", errors.length ? `${summary}: ${errors.join("; ")}` : summary);
  return Response.json({ ok: errors.length === 0, webhookEventsDeleted: webhookEvents ?? 0, pipelineEventsDeleted: pipelineEvents ?? 0, meetingsTrimmed: trimmed, cutoff, errors }, { status: errors.length ? 500 : 200 });
}
