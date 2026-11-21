// GET /api/cron/calls: Vercel Cron every 2 minutes (vercel.json) with "Authorization: Bearer CRON_SECRET".
// Polls Callyzer for calls on DNY's client lines, copies and transcribes their recordings, and starts the
// routine when a call is ready (src/lib/calls/job.ts). The response carries counts only: no number, name
// or link.

import { RUN_DEADLINE_MS } from "@/lib/calls/budget";
import { runCallsJob } from "@/lib/calls/job";
import { errorText } from "@/lib/calls/sanitize";
import { serverCallsDeps } from "@/lib/calls/server";
import { optionalEnv } from "@/lib/env";
import { presentedBearer, secretMatches } from "@/lib/webhooks";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!secretMatches(presentedBearer(request), optionalEnv("CRON_SECRET"))) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const result = await runCallsJob(serverCallsDeps(), { deadlineMs: RUN_DEADLINE_MS });
    return Response.json({ ok: true, ...result, tookMs: Date.now() - startedAt, at: new Date().toISOString() });
  } catch (error) {
    const message = errorText(error);
    console.error(`cron calls failed: ${message}`);
    return Response.json({ ok: false, error: message, tookMs: Date.now() - startedAt }, { status: 500 });
  }
}
