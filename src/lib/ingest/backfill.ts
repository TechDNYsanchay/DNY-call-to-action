import "server-only";

// CONTRACT (owned by the ingest module): list the tl;dv meetings of the last `days` days and upsert
// the ones not seen yet with source 'backfill' (transcripts are fetched by the cron tick afterwards).

import { tldv } from "@/lib/tldv/client";
import { logEvent, upsertMeeting } from "./intake";

/** The plan allows 14 days; the hard ceiling protects against a typo in the admin dialog. */
export const MAX_BACKFILL_DAYS = 30;

export async function backfillMeetings(days: number): Promise<{ seen: number; created: number }> {
  const span = Math.min(Math.max(Math.floor(days) || 1, 1), MAX_BACKFILL_DAYS);
  const now = new Date();
  const from = new Date(now.getTime() - span * 86_400_000).toISOString();
  const meetings = await tldv().listMeetingsSince(from, { to: now.toISOString(), maxPages: 50 });
  let created = 0;
  for (const meeting of meetings) {
    const result = await upsertMeeting(meeting, "backfill");
    if (result.created) created++;
  }
  await logEvent("info", "backfill", `Backfill of ${span} days: ${meetings.length} meetings seen, ${created} new`);
  return { seen: meetings.length, created };
}
