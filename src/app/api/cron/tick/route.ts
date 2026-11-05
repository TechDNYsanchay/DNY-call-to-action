// GET /api/cron/tick: Vercel Cron every 10 minutes (vercel.json) with "Authorization: Bearer CRON_SECRET".
// Lists recent tl;dv meetings, retries pending transcripts, releases stale routine claims.

import { optionalEnv } from "@/lib/env";
import { tick } from "@/lib/ingest/sync";
import { presentedBearer, secretMatches } from "@/lib/webhooks";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!secretMatches(presentedBearer(request), optionalEnv("CRON_SECRET"))) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const counts = await tick({ deadlineMs: 240_000 });
    return Response.json({ ok: true, ...counts, tookMs: Date.now() - startedAt, at: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`cron tick failed: ${message}`);
    return Response.json({ ok: false, error: message, tookMs: Date.now() - startedAt }, { status: 500 });
  }
}
