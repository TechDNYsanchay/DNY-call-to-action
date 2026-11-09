import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { nextSlot } from "@/lib/booking";
import { requireUser } from "@/lib/auth/require-user";
import { listActivePeople } from "@/lib/data/people";
import { connection, googleConfigured, recordingAccount } from "@/lib/google";
import { supabaseServer } from "@/lib/supabase/server";
import { BookingForm } from "@/components/bookings/booking-form";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { InlineNote } from "@/components/ui/states";

export const metadata: Metadata = { title: "Book a client meeting" };

// The booking form. Only offered once the recording calendar is connected, so nobody fills it in
// for nothing.
export default async function NewBookingPage() {
  const { person } = await requireUser();
  const db = await supabaseServer();
  const [connected, people, clients] = await Promise.all([connection(), listActivePeople(), db.from("clients").select("id, name, contact_emails").neq("status", "churned").order("name")]);
  if (clients.error) throw new Error(`clients: ${clients.error.message}`);
  const ready = googleConfigured() && Boolean(connected);

  return (
    <div className="mx-auto max-w-[720px]">
      <Link href="/bookings" className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} aria-hidden="true" />
        Client meetings
      </Link>
      <PageHeader title="Book a client meeting" description={`The invite comes from ${recordingAccount()} with a Google Meet link; tl;dv records it and the sheet follows`} />
      {ready ? (
        <BookingForm
          clients={(clients.data ?? []).map((c) => ({ id: c.id, name: c.name, contactEmails: c.contact_emails }))}
          people={people.map((p) => ({ id: p.id, name: p.full_name, email: p.email }))}
          meId={person.id}
          start={nextSlot(new Date().getTime())}
        />
      ) : (
        <InlineNote
          title="Booking isn't open yet"
          actions={
            <Link href="/bookings" className={buttonClass("secondary")}>
              Back to client meetings
            </Link>
          }
        >
          An admin connects the recording calendar ({recordingAccount()}) on the Client meetings page first.
        </InlineNote>
      )}
    </div>
  );
}
