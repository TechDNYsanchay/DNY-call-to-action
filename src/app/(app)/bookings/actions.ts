"use server";

// Booking and cancelling client meetings. Anyone on the team list can book; the meeting is created
// on the recording account's calendar, so tl;dv records it, and its Meet code brings the recording
// back to this booking (and its client) without any classifying.

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { calendarEvent, isDnyEmail, meetingLinkMessage, parseBookingForm, whatsappShareLink, whenText, type BookingForm, type FieldErrors, type Guest } from "@/lib/booking";
import { cancelMeeting, createMeeting, GoogleNotReady } from "@/lib/google";
import { supabaseAdmin } from "@/lib/supabase/server";
import { type ActionResult, failed, ok } from "@/lib/ui/action-result";

export interface Booked {
  clientName: string;
  when: string;
  meetUrl: string;
  message: string;
  whatsapp: string;
}

export type BookResult = { ok: true; booked: Booked } | { ok: false; errors: FieldErrors };

const formError = (form: string): BookResult => ({ ok: false, errors: { form } });

export async function bookClientMeeting(input: BookingForm): Promise<BookResult> {
  const { person: me } = await requireUser();
  const parsed = parseBookingForm(input, Date.now());
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const b = parsed.value;
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
    .insert({ client_id: clientId, client_name: clientName, client_emails: b.clientEmails, starts_at: b.startsAt, duration_min: b.durationMin, notes: b.notes, attendee_ids: b.attendeeIds, booked_by: me.id })
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

  const { error: saveError } = await db.from("client_meeting_bookings").update({ calendar_event_id: meeting.eventId, meet_url: meeting.meetUrl, meet_code: meeting.meetCode }).eq("id", booking.id);
  if (saveError) return formError(`The invites went out, but the booking couldn't be saved: ${saveError.message}`);

  // A known client remembers the new addresses, so later meetings with them are recognised too.
  if (existing) {
    const merged = [...new Set([...existing.contact_emails, ...outside])];
    if (merged.length > existing.contact_emails.length) await db.from("clients").update({ contact_emails: merged }).eq("id", existing.id);
  }

  revalidatePath("/bookings");
  revalidatePath("/clients");
  const message = meetingLinkMessage(b.startsAt, meeting.meetUrl);
  return { ok: true, booked: { clientName, when: whenText(b.startsAt), meetUrl: meeting.meetUrl, message, whatsapp: whatsappShareLink(message) } };
}

/** Cancels a meeting still to come: the invite is withdrawn (guests are emailed) and the booking kept as cancelled. */
export async function cancelClientMeeting(id: string): Promise<ActionResult> {
  try {
    const { person: me, isAdmin } = await requireUser();
    const db = supabaseAdmin();
    const { data: booking, error } = await db.from("client_meeting_bookings").select("id, booked_by, attendee_ids, calendar_event_id, status, starts_at, duration_min").eq("id", id).maybeSingle();
    if (error) throw new Error(`Couldn't load the meeting: ${error.message}`);
    if (!booking || booking.status === "cancelled") throw new Error("This meeting is already cancelled; refresh the page.");
    if (!isAdmin && booking.booked_by !== me.id && !booking.attendee_ids.includes(me.id)) throw new Error("Only whoever booked or attends the meeting can cancel it.");
    if (Date.parse(booking.starts_at) + booking.duration_min * 60_000 < Date.now()) throw new Error("This meeting has already happened.");
    if (booking.calendar_event_id) await cancelMeeting(booking.calendar_event_id);
    const { error: saveError } = await db.from("client_meeting_bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", id);
    if (saveError) throw new Error(`The invite was withdrawn, but the booking couldn't be updated: ${saveError.message}`);
    revalidatePath("/bookings");
    return ok();
  } catch (e) {
    return failed(e, "Couldn't cancel. Please try again.");
  }
}
