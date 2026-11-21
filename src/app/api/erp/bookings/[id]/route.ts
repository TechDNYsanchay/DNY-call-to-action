// Sync cancels a meeting it booked. Who may cancel is Sync's to decide (its scheduler, or someone
// who edits the project); here the invite is withdrawn and the booking kept as cancelled.

import { bookingForCancel, cancelClientBooking } from "@/lib/booking-store";
import { parseBookingIds } from "@/lib/erp/contract";
import { erpGuard, erpJson } from "@/lib/erp/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = erpGuard(request);
  if (refused) return refused;
  const { id } = await params;
  const ids = parseBookingIds(id);
  if (!ids.ok || ids.ids.length !== 1) return erpJson({ error: "Not a booking id." }, 400);
  try {
    const booking = await bookingForCancel(ids.ids[0]);
    await cancelClientBooking(booking);
    return erpJson({ cancelled: true });
  } catch (e) {
    return erpJson({ error: e instanceof Error ? e.message : String(e) }, 409);
  }
}
