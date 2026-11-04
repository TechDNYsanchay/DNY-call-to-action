import "server-only";

// CONTRACT (owned by the ingest module): list the tl;dv meetings of the last `days` days and upsert
// the ones not seen yet with source 'backfill' (transcripts are fetched by the cron tick afterwards).
export async function backfillMeetings(days: number): Promise<{ seen: number; created: number }> {
  void days;
  throw new Error("backfillMeetings is not implemented yet");
}
