import "server-only";
import { recordingState, type RecordingState } from "@/lib/booking";
import { supabaseServer } from "@/lib/supabase/server";

// Client meetings booked from the app, read as the signed-in person (everyone on the team list).

export interface BookingListRow {
  id: string;
  clientId: string | null;
  clientName: string;
  clientEmails: string[];
  startsAt: string;
  durationMin: number;
  notes: string | null;
  attendees: Array<{ id: string; name: string }>;
  attendeeIds: string[];
  bookedBy: { id: string; name: string } | null;
  meetUrl: string | null;
  meetingId: string | null;
  state: RecordingState;
}

/** Meetings to come (and any happening now), soonest first; the last 60 days' meetings, latest first. */
export async function listBookings(nowMs: number): Promise<{ upcoming: BookingListRow[]; past: BookingListRow[] }> {
  const db = await supabaseServer();
  const since = new Date(nowMs - 60 * 86_400_000).toISOString();
  const { data, error } = await db
    .from("client_meeting_bookings")
    .select("id, client_id, client_name, client_emails, starts_at, duration_min, notes, attendee_ids, booked_by, meet_url, status, meeting_id, meeting:meetings(process_status)")
    .gte("starts_at", since)
    .order("starts_at", { ascending: true })
    .limit(300);
  if (error) throw new Error(`bookings: ${error.message}`);
  const rows = data ?? [];

  const personIds = [...new Set(rows.flatMap((r) => [...r.attendee_ids, ...(r.booked_by ? [r.booked_by] : [])]))];
  const names = new Map<string, string>();
  if (personIds.length) {
    const { data: people, error: peopleError } = await db.from("people").select("id, full_name").in("id", personIds);
    if (peopleError) throw new Error(`people: ${peopleError.message}`);
    for (const p of people ?? []) names.set(p.id, p.full_name);
  }

  const list = rows.map((r): BookingListRow => ({
    id: r.id,
    clientId: r.client_id,
    clientName: r.client_name,
    clientEmails: r.client_emails,
    startsAt: r.starts_at,
    durationMin: r.duration_min,
    notes: r.notes,
    attendees: r.attendee_ids.map((id) => ({ id, name: names.get(id) ?? "Former team member" })),
    attendeeIds: r.attendee_ids,
    bookedBy: r.booked_by ? { id: r.booked_by, name: names.get(r.booked_by) ?? "Former team member" } : null,
    meetUrl: r.meet_url,
    meetingId: r.meeting_id,
    state: recordingState({ status: r.status, startsAt: r.starts_at, durationMin: r.duration_min, meetingStatus: r.meeting?.process_status ?? null, hasMeeting: Boolean(r.meeting_id) }, nowMs),
  }));
  const ahead = (b: BookingListRow) => b.state === "upcoming" || b.state === "live";
  return { upcoming: list.filter(ahead), past: list.filter((b) => !ahead(b)).reverse() };
}
