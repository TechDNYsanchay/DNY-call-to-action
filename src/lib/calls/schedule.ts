// When the calls job may talk to Callyzer, and which days it asks for. Pure.
// Sales QA polls Callyzer with the same company key at :00, :15, :30 and :45 UTC (its vercel.json:
// "*/15 3-17 * * *" and "0 19 * * *"), and Callyzer allows one request per second per key. This app never
// sends a request from 10 s before to 90 s after any of those minutes, all day, so the two apps never meet.
// If Sales QA's schedule changes, change SALES_QA_CALLYZER_MINUTES here too.

import { istDate } from "@/lib/format";
import type { DayWindow } from "./types";

export const SALES_QA_CALLYZER_MINUTES = [0, 15, 30, 45] as const;
const QUIET_BEFORE_MS = 10_000;
const QUIET_AFTER_MS = 90_000;
const HOUR_MS = 3_600_000;

/** 0 when a Callyzer request may go now, else the milliseconds until it may. */
export function quietWaitMs(now: Date): number {
  const t = ((now.getTime() % HOUR_MS) + HOUR_MS) % HOUR_MS;
  // Minute 60 is the next hour's :00, whose quiet window starts at :59:50 of this hour.
  for (const minute of [...SALES_QA_CALLYZER_MINUTES, 60]) {
    const from = minute * 60_000 - QUIET_BEFORE_MS;
    const until = minute * 60_000 + QUIET_AFTER_MS;
    if (t >= from && t < until) return until - t;
  }
  return 0;
}

/** The night-poll choices an admin can pick (minutes); 2 is every run (D6). */
export const NIGHT_POLL_CHOICES = [2, 4, 6, 10, 20, 30] as const;

/**
 * Whether this run polls Callyzer. Every run does, except at night (23:30-08:30 IST, 18:00-03:00 UTC,
 * when Sales QA's sync is idle) when an admin chose a slower night cadence: then only runs whose minute
 * leaves 2 when divided by it. Copies and transcription run every time regardless.
 */
export function pollDue(now: Date, nightEvery: number): boolean {
  if (nightEvery <= 2) return true;
  const hour = now.getUTCHours();
  if (hour >= 3 && hour < 18) return true;
  return now.getUTCMinutes() % nightEvery === 2;
}

/** Midnight IST of the day `now` falls on, as an ISO instant. */
export function istDayStartIso(now: Date): string {
  const [y, m, d] = istDate(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 5.5 * HOUR_MS).toISOString();
}

/** YYYY-MM-DD `days` before an IST day (negative goes forward). */
export function ymdMinus(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - days * 86_400_000).toISOString().slice(0, 10);
}

/** A wide read (today-2..today) every 10 minutes catches links that arrive late, across midnight. */
export const WIDE_READ_EVERY_MS = 10 * 60_000;
export const WIDE_READ_DAYS = 2;
/** "Re-read a day" goes back at most this many days, and a run takes at most two such requests. */
export const REREAD_MAX_DAYS = 14;
export const REREADS_PER_RUN = 2;

/**
 * What one polling run reads: today (or today-2..today when the last wide read is 10 minutes old or
 * more), plus up to two pending "Re-read a day" requests from the last 14 days, one day each.
 */
export function pollWindows(now: Date, lastWideReadAt: string | null, rereads: string[]): DayWindow[] {
  const today = istDate(now);
  const lastWide = lastWideReadAt ? Date.parse(lastWideReadAt) : NaN;
  const wide = !Number.isFinite(lastWide) || now.getTime() - lastWide >= WIDE_READ_EVERY_MS;
  const oldest = ymdMinus(today, REREAD_MAX_DAYS);
  const days = [...new Set(rereads)].filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= oldest && day <= today).slice(0, REREADS_PER_RUN);
  return [{ from: wide ? ymdMinus(today, WIDE_READ_DAYS) : today, to: today, rereadDay: null }, ...days.map((day) => ({ from: day, to: day, rereadDay: day }))];
}

/** Callyzer pages are 100 rows; a window never takes more than 10 pages (then the job warns). */
export const CALLYZER_PAGE_SIZE = 100;
export const CALLYZER_MAX_PAGES = 10;

/**
 * After page `pageNo` (1-based) of `pageLen` rows, `fetched` rows so far: fetch another page while the
 * page was full and the total is unknown or not reached yet, up to 10 pages. A missing total does not
 * stop paging (Sales QA's reader stops there and misses rows).
 */
export function shouldFetchMore(pageLen: number, fetched: number, total: number | null, pageNo: number): boolean {
  if (pageNo >= CALLYZER_MAX_PAGES || pageLen < CALLYZER_PAGE_SIZE) return false;
  return total === null || fetched < total;
}
