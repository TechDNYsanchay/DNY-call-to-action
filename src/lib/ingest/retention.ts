// Retention arithmetic for the nightly cron (pure, tested).

/** Meetings that happened before this instant are older than the retention window. */
export function retentionCutoff(months: number, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - Math.max(1, Math.floor(months) || 1));
  return d;
}
