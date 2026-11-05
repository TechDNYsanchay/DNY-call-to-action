// Links from evidence to the tl;dv recording. The timestamp parameter is only appended once the
// real format is known (TLDV_TIMESTAMP_PARAM in the environment); the server passes the name down.

/** The recording page, at the second when the parameter name is known and the seconds are usable. */
export function recordingUrl(tldvUrl: string | null, seconds: number | null, param: string | null | undefined): string | null {
  if (!tldvUrl) return null;
  if (!param || seconds == null || !Number.isFinite(seconds) || seconds < 0) return tldvUrl;
  try {
    const url = new URL(tldvUrl);
    url.searchParams.set(param, String(Math.floor(seconds)));
    return url.toString();
  } catch {
    return tldvUrl;
  }
}

/** "Open recording at 12 minutes 34 seconds, quote from Rahul" for screen readers. */
export function evidenceAriaLabel(seconds: number | null, speaker: string | null): string {
  const where = seconds == null ? "" : ` at ${spokenTime(seconds)}`;
  const who = speaker ? `, quote from ${speaker}` : "";
  return `Open recording${where}${who}`;
}

export function spokenTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  parts.push(`${sec} second${sec === 1 ? "" : "s"}`);
  return parts.join(" ");
}
