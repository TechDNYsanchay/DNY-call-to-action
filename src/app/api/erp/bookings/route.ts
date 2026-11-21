// Sync books a client meeting for one of its projects. The booking is made exactly as the Bookings
// screen makes one (lib/booking-store.ts): the Google Calendar event on the recording account, so
// tl;dv records it and its action items come back to this booking.

import { parseBookingForm } from "@/lib/booking";
import { createClientBooking } from "@/lib/booking-store";
import { bookingRequest } from "@/lib/erp/contract";
import { erpGuard, erpJson } from "@/lib/erp/guard";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const refused = erpGuard(request);
  if (refused) return refused;

  const parsed = bookingRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return erpJson({ error: "The booking is not in the expected shape.", issues: parsed.error.issues.slice(0, 10) }, 400);
  const b = parsed.data;

  // DNY's people are invited by their address on the team list here.
  const db = supabaseAdmin();
  const wanted = [...new Set([...b.attendee_emails, b.booked_by_email])];
  const { data: people, error } = await db.from("people").select("id, email, active").in("email", wanted);
  if (error) return erpJson({ error: `Couldn't read the team list: ${error.message}` }, 500);
  const byEmail = new Map((people ?? []).filter((p) => p.active).map((p) => [p.email, p.id] as const));
  const missing = b.attendee_emails.filter((e) => !byEmail.has(e));
  if (missing.length) {
    return erpJson({ errors: { attendeeIds: `Not on the Call to Action team list: ${missing.join(", ")}` } }, 422);
  }

  const form = parseBookingForm(
    {
      clientName: b.client_name,
      clientEmails: b.client_emails.join(", "),
      date: b.date,
      time: b.time,
      durationMin: b.duration_min,
      attendeeIds: b.attendee_emails.map((e) => byEmail.get(e)!),
      notes: b.notes ?? "",
    },
    Date.now(),
  );
  if (!form.ok) return erpJson({ errors: form.errors }, 422);

  const result = await createClientBooking(form.value, byEmail.get(b.booked_by_email) ?? null);
  if (!result.ok) return erpJson({ errors: result.errors }, 422);
  const k = result.booked;
  return erpJson({
    booking: {
      id: k.bookingId,
      client_name: k.clientName,
      starts_at: k.startsAt,
      meet_url: k.meetUrl,
      recorder_must_be_admitted: k.recorderMustBeAdmitted,
    },
  });
}
