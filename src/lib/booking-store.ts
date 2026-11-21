import "server-only";

// Booking and cancelling a client meeting, shared by the Bookings screen and the ERP API
// (/api/erp/bookings). Who may do it is checked by the caller; this does the work: the client row,
// the booking row, the Google Calendar event on the recording account (so tl;dv records it) and the
// Meet code that brings the recording back to the booking.

import { calendarEvent, isDnyEmail, meetingLinkMessage, whatsappShareLink, whenText, type BookingRequest, type FieldErrors, type Guest } from "@/lib/booking";
import { cancelMeeting, createMeeting, GoogleNotReady } from "@/lib/google";
import { supabaseAdmin } from "@/lib/supabase/server";

export interface Booked {
  bookingId: string;
  clientName: string;
  startsAt: string;
  when: string;
  meetUrl: string;
  message: string;
  whatsapp: string;
  /** Null when tl;dv's recorder joins by itself; otherwise why someone in the call must admit it. */
  recorderMustBeAdmitted: string | null;
}

export type BookResult = { ok: true; booked: Booked } | { ok: false; errors: FieldErrors };

const formError = (form: string): BookResult => ({ ok: false, errors: { form } });

/** Books a checked request. `bookedBy` is a people.id, or null when the booker is not on the team list. */
export async function createClientBooking(b: BookingRequest, bookedBy: string | null): Promise<BookResult> {
  const db = supabaseAdmin();

  // DNY's people: active people on the team list.
  const { data: attendees, error: peopleError } = await db.from("people").select("id, full_name, email").in("id", b.attendeeIds).eq("active", true);
  if (peopleError) return formError(`Couldn't check the team list: ${peopleError.message}`);
  if ((attendees ?? []).length !== b.attendeeIds.length) return { ok: false, errors: { attendeeIds: "Pick people who are on the team list" } };

  // The client with this name (any case), or a new one with the addresses typed as its contacts.
  const outside = b.clientEmails.filter((e) => !isDnyEmail(e));
  const { data: clients, error: clientsError } = await db.from("clients").select("id, name, contact_emails");
  if (clientsError) return formError(`Couldn't read the client list: ${clientsError.message}`);
  const existing = (clients ?? []).find((c) => c.name.trim().toLowerCase() === b.clientName.toLowerCase()) ?? null;
  const clientName = existing?.name ?? b.clientName;
  let clientId = existing?.id ?? null;
  if (!existing) {
    const { data, error } = await db.from("clients").insert({ name: clientName, contact_emails: outside, status: "active", notes: "Added when a meeting was booked." }).select("id").single();
    if (error) return formError(`Couldn't add the client: ${error.message}`);
    clientId = data.id;
  }

  const { data: booking, error: bookingError } = await db
    .from("client_meeting_bookings")
    .insert({ client_id: clientId, client_name: clientName, client_emails: b.clientEmails, starts_at: b.startsAt, duration_min: b.durationMin, notes: b.notes, attendee_ids: b.attendeeIds, booked_by: bookedBy })
    .select("id")
    .single();
  if (bookingError) {
    if (!existing && clientId) await db.from("clients").delete().eq("id", clientId);
    return formError(`Couldn't save the booking: ${bookingError.message}`);
  }

  const guests: Guest[] = [...b.clientEmails.map((email) => ({ email, name: null })), ...(attendees ?? []).map((p) => ({ email: p.email, name: p.full_name }))];
  let meeting: Awaited<ReturnType<typeof createMeeting>>;
  try {
    meeting = await createMeeting(calendarEvent({ bookingId: booking.id, clientName, startsAt: b.startsAt, durationMin: b.durationMin, guests, notes: b.notes }));
  } catch (error) {
    // No invite went out, so nothing is kept.
    await db.from("client_meeting_bookings").delete().eq("id", booking.id);
    if (!existing && clientId) await db.from("clients").delete().eq("id", clientId);
    const reason = error instanceof Error ? error.message : String(error);
    return formError(error instanceof GoogleNotReady ? reason : `Couldn't create the meeting: ${reason}`);
  }
  if (meeting.recorderMustBeAdmitted) console.warn(`Booking ${booking.id}: Meet not opened, the recorder will ask to join (${meeting.recorderMustBeAdmitted})`);

  const { error: saveError } = await db.from("client_meeting_bookings").update({ calendar_event_id: meeting.eventId, meet_url: meeting.meetUrl, meet_code: meeting.meetCode }).eq("id", booking.id);
  if (saveError) return formError(`The invites went out, but the booking couldn't be saved: ${saveError.message}`);

  // A known client remembers the new addresses, so later meetings with them are recognised too.
  if (existing) {
    const merged = [...new Set([...existing.contact_emails, ...outside])];
    if (merged.length > existing.contact_emails.length) await db.from("clients").update({ contact_emails: merged }).eq("id", existing.id);
  }

  const message = meetingLinkMessage(b.startsAt, meeting.meetUrl);
  return {
    ok: true,
    booked: {
      bookingId: booking.id,
      clientName,
      startsAt: b.startsAt,
      when: whenText(b.startsAt),
      meetUrl: meeting.meetUrl,
      message,
      whatsapp: whatsappShareLink(message),
      recorderMustBeAdmitted: meeting.recorderMustBeAdmitted,
    },
  };
}

export interface BookingRow {
  id: string;
  booked_by: string | null;
  attendee_ids: string[];
  calendar_event_id: string | null;
  status: string;
  starts_at: string;
  duration_min: number;
}

/** Reads a booking for cancelling, or says why it cannot be. */
export async function bookingForCancel(id: string): Promise<BookingRow> {
  const db = supabaseAdmin();
  const { data: booking, error } = await db.from("client_meeting_bookings").select("id, booked_by, attendee_ids, calendar_event_id, status, starts_at, duration_min").eq("id", id).maybeSingle();
  if (error) throw new Error(`Couldn't load the meeting: ${error.message}`);
  if (!booking || booking.status === "cancelled") throw new Error("This meeting is already cancelled; refresh the page.");
  if (Date.parse(booking.starts_at) + booking.duration_min * 60_000 < Date.now()) throw new Error("This meeting has already happened.");
  return booking;
}

/** Withdraws the invite (guests are emailed) and keeps the booking as cancelled. */
export async function cancelClientBooking(booking: BookingRow): Promise<void> {
  const db = supabaseAdmin();
  if (booking.calendar_event_id) await cancelMeeting(booking.calendar_event_id);
  const { error: saveError } = await db.from("client_meeting_bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", booking.id);
  if (saveError) throw new Error(`The invite was withdrawn, but the booking couldn't be updated: ${saveError.message}`);
}
