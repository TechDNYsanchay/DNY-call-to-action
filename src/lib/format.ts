// Dates and times. Everything the user sees is in India (Asia/Kolkata); the database stores UTC.

export const IST = "Asia/Kolkata";

/** Seconds -> "m:ss" or "h:mm:ss" (the marker in front of every transcript line). */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** "12:34" / "1:02:10" / "[12:34]" -> seconds; null when it is not a timestamp. */
export function secondsFrom(marker: string): number | null {
  const m = marker.trim().replace(/^\[|\]$/g, "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, a, b, c] = m;
  return c !== undefined ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
}

/** Duration in words: "42 min", "1 h 05 min". */
export function formatDuration(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, "0")} min` : `${h} h`;
}

const parts = (iso: string | Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: IST, ...options }).format(typeof iso === "string" ? new Date(iso) : iso);

/** "Tue 4 Nov 2026, 10:30" */
export function formatDateTimeIst(iso: string | Date): string {
  return parts(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");
}

/** "Tuesday 4 November 2026" (the meeting date as the model sees it). */
export function formatLongDateIst(iso: string | Date): string {
  return parts(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** "10:30" in IST. */
export function formatTimeIst(iso: string | Date): string {
  return parts(iso, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "Fri 7 Nov" for a YYYY-MM-DD date. */
export function formatShortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The calendar date (YYYY-MM-DD) in IST of an instant. */
export function istDate(iso: string | Date): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** Whole days from today (IST) to a YYYY-MM-DD date; negative when overdue. */
export function daysUntil(ymd: string, now: Date = new Date()): number {
  const today = istDate(now);
  const a = Date.UTC(...(today.split("-").map(Number) as [number, number, number]).map((n, i) => (i === 1 ? n - 1 : n)) as [number, number, number]);
  const b = Date.UTC(...(ymd.split("-").map(Number) as [number, number, number]).map((n, i) => (i === 1 ? n - 1 : n)) as [number, number, number]);
  return Math.round((b - a) / 86_400_000);
}

/** "today", "tomorrow", "in 3 days", "2 days overdue". */
export function relativeDue(ymd: string, now: Date = new Date()): string {
  const d = daysUntil(ymd, now);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "1 day overdue";
  if (d < 0) return `${-d} days overdue`;
  if (d < 14) return `in ${d} days`;
  const w = Math.round(d / 7);
  return `in ${w} week${w === 1 ? "" : "s"}`;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago". */
export function timeAgo(iso: string | Date, now: Date = new Date()): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} h ago`;
  const days = Math.floor(diff / 86_400);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDateTimeIst(iso).split(",")[0];
}
