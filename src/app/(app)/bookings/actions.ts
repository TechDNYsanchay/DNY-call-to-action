"use server";

// Booking and cancelling client meetings. Anyone on the team list can book; the meeting is created
// on the recording account's calendar, so tl;dv records it, and its Meet code brings the recording
// back to this booking (and its client) without any classifying. The work itself is in
// lib/booking-store.ts, shared with the ERP API.

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { parseBookingForm, type BookingForm } from "@/lib/booking";
import { bookingForCancel, cancelClientBooking, createClientBooking, type BookResult } from "@/lib/booking-store";
import { type ActionResult, failed, ok } from "@/lib/ui/action-result";

export type { Booked, BookResult } from "@/lib/booking-store";

export async function bookClientMeeting(input: BookingForm): Promise<BookResult> {
  const { person: me } = await requireUser();
  const parsed = parseBookingForm(input, Date.now());
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const result = await createClientBooking(parsed.value, me.id);
  if (result.ok) {
    revalidatePath("/bookings");
    revalidatePath("/clients");
  }
  return result;
}

/** Cancels a meeting still to come: the invite is withdrawn (guests are emailed) and the booking kept as cancelled. */
export async function cancelClientMeeting(id: string): Promise<ActionResult> {
  try {
    const { person: me, isAdmin } = await requireUser();
    const booking = await bookingForCancel(id);
    if (!isAdmin && booking.booked_by !== me.id && !booking.attendee_ids.includes(me.id)) throw new Error("Only whoever booked or attends the meeting can cancel it.");
    await cancelClientBooking(booking);
    revalidatePath("/bookings");
    return ok();
  } catch (e) {
    return failed(e, "Couldn't cancel. Please try again.");
  }
}
