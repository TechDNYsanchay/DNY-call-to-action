// The API Sync (DNY's ERP, TechDNYsanchay/dny-erp) calls to book client meetings from a project and
// to collect the DNY-owed action items of those meetings for approval there. Pure: shapes and checks
// only, so they are unit-tested; the routes under src/app/api/erp/ do the work.
//
// Every call carries Authorization: Bearer <ERP_INTEGRATION_SECRET>. Every response carries
// "contract": "1", so either side can tell when the other has moved on.

import { z } from "zod";

export const CONTRACT = "1";

const email = z.string().trim().toLowerCase().email().max(254);

/** POST /api/erp/bookings */
export const bookingRequest = z.object({
  contract: z.literal(CONTRACT),
  booked_by_email: email,
  client_name: z.string().trim().min(2).max(80),
  client_emails: z.array(email).min(1).max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  duration_min: z.number().int(),
  attendee_emails: z.array(email).min(1).max(20),
  notes: z.string().max(500).optional().nullable(),
});
export type BookingRequestBody = z.infer<typeof bookingRequest>;

/** GET /api/erp/action-items?booking_ids=a,b,c — at most this many at once. */
export const MAX_BOOKINGS_PER_READ = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The booking ids asked for, or why they are not acceptable. */
export function parseBookingIds(raw: string | null): { ok: true; ids: string[] } | { ok: false; error: string } {
  const ids = [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (!ids.length) return { ok: true, ids: [] };
  if (ids.length > MAX_BOOKINGS_PER_READ) return { ok: false, error: `Ask for at most ${MAX_BOOKINGS_PER_READ} bookings at a time` };
  const bad = ids.find((id) => !UUID.test(id));
  if (bad) return { ok: false, error: `Not a booking id: ${bad.slice(0, 40)}` };
  return { ok: true, ids };
}

/** Which action items go to Sync: what DNY owes, alone or with the client, and not replaced by a re-run. */
export function goesToErp(item: { owed_by: string; status: string }): boolean {
  return (item.owed_by === "dny" || item.owed_by === "both") && item.status !== "superseded";
}

export interface ErpActionItem {
  id: string;
  title: string;
  details: string;
  owed_by: "dny" | "both";
  owner_email: string | null;
  owner_name: string | null;
  due_date: string | null;
  priority: "high" | "medium" | "low";
  status: "open" | "in_progress" | "done" | "dropped";
  evidence: string | null;
}

/** The quote a reviewer in Sync reads to judge an item: "[12:34] Priya: “…”". */
export function evidenceLine(i: { evidence_ts_sec: number | null; evidence_speaker: string | null; evidence_quote: string | null }): string | null {
  const quote = i.evidence_quote?.trim();
  if (!quote) return null;
  const at = i.evidence_ts_sec == null ? "" : `[${Math.floor(i.evidence_ts_sec / 60)}:${String(i.evidence_ts_sec % 60).padStart(2, "0")}] `;
  const who = i.evidence_speaker?.trim() ? `${i.evidence_speaker.trim()}: ` : "";
  return `${at}${who}“${quote}”`;
}

/** GET /api/erp/calls?since=… — how far back Sync may ask, and how far it asks when it does not say. */
export const CALLS_DEFAULT_DAYS = 14;
export const CALLS_MAX_DAYS = 30;
export const MAX_CALLS_PER_READ = 500;

/**
 * The moment Sync asks from: its `since`, held to the last CALLS_MAX_DAYS days, or CALLS_DEFAULT_DAYS
 * back when it sends none.
 */
export function parseSince(raw: string | null, now: number): { ok: true; since: Date } | { ok: false; error: string } {
  const floor = now - CALLS_MAX_DAYS * 86_400_000;
  if (!raw) return { ok: true, since: new Date(now - CALLS_DEFAULT_DAYS * 86_400_000) };
  const t = Date.parse(raw);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw) || Number.isNaN(t)) return { ok: false, error: "since is not a date" };
  return { ok: true, since: new Date(Math.max(t, floor)) };
}

/**
 * A conversation Sync did not book: a phone call on a client-work line, or a recording nobody booked
 * from Sync. Sync decides who approves its CTAs from the line's people, then whoever recorded it.
 * The counterpart's number is never sent.
 */
export interface ErpCall {
  id: string;
  kind: "call" | "meeting";
  title: string | null;
  happened_at: string;
  duration_sec: number;
  client_name: string | null;
  counterpart_name: string | null;
  line_name: string | null;
  line_member_emails: string[];
  organizer_email: string | null;
  process_status: string;
  url: string;
  items: ErpActionItem[];
}
