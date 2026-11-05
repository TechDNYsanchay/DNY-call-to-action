// POST /api/webhooks/tldv: tl;dv's MeetingReady and TranscriptReady events. The payload is a hint
// only: the meeting and the transcript are always re-fetched from the API, so a forged body cannot
// inject data. tl;dv waits 10 s for a 2xx and retries otherwise, so the answer goes out within 8 s
// and anything slower is left for the cron, which lists recent meetings every 10 minutes anyway.

import { optionalEnv } from "@/lib/env";
import { logEvent } from "@/lib/ingest/intake";
import { syncMeeting } from "@/lib/ingest/sync";
import { isStaleWebhook, webhookEventId } from "@/lib/ingest/webhook-id";
import { supabaseAdmin } from "@/lib/supabase/server";
import { parseTldvWebhook } from "@/lib/tldv/parse";
import { readWebhook } from "@/lib/webhooks";

export const maxDuration = 60;

const BUDGET_MS = 8_000;

export async function POST(request: Request) {
  const startedAt = Date.now();
  const read = await readWebhook(request, optionalEnv("TLDV_WEBHOOK_SECRET"));
  if ("error" in read) return read.error;

  const hook = parseTldvWebhook(read.payload);
  if (!hook) {
    console.warn("webhook tldv: body was not a tl;dv event (no event or meeting id)");
    return Response.json({ ok: true, ignored: true, reason: "Not a tl;dv meeting event" });
  }
  if (isStaleWebhook(hook.executedAt)) return Response.json({ ok: true, ignored: true, reason: "Event older than 24 hours" });

  const eventId = webhookEventId(hook);
  const { error } = await supabaseAdmin().from("webhook_events").insert({ id: eventId, event: hook.event, tldv_meeting_id: hook.meetingId });
  if (error?.code === "23505") return Response.json({ ok: true, duplicate: true });
  if (error) console.error(`webhook tldv: webhook_events insert failed: ${error.message}`);

  // Never trust the embedded transcript; syncMeeting fetches both the meeting and the transcript.
  const remaining = Math.max(500, BUDGET_MS - (Date.now() - startedAt));
  const work = syncMeeting(hook.meetingId, "webhook");
  const outcome = await Promise.race([
    work.then((result) => ({ kind: "done" as const, result })).catch((err: unknown) => ({ kind: "error" as const, err })),
    new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), remaining)),
  ]);

  if (outcome.kind === "timeout") {
    // The sync keeps going in the background; if the function is frozen first, the cron finishes it.
    work.catch((err: unknown) => console.error(`webhook tldv: late sync of ${hook.meetingId} failed: ${err instanceof Error ? err.message : String(err)}`));
    return Response.json({ ok: true, accepted: true, pending: true, event: hook.event });
  }
  if (outcome.kind === "error") {
    const message = outcome.err instanceof Error ? outcome.err.message : String(outcome.err);
    await logEvent("error", "webhook", `${hook.event} for ${hook.meetingId}: ${message}`);
    // Still 2xx: a tl;dv retry would be deduplicated anyway; the cron re-drives the meeting.
    return Response.json({ ok: true, accepted: true, error: message, event: hook.event });
  }
  const { result } = outcome;
  return Response.json({ ok: true, event: hook.event, meetingId: result.meetingId, status: result.status, created: result.created, transcriptStored: result.transcriptStored });
}
