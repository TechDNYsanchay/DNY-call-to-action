import { CalendarPlus } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import type { RecordingState } from "@/lib/booking";
import { requireUser } from "@/lib/auth/require-user";
import { listBookings, type BookingListRow } from "@/lib/data/bookings";
import { formatDateTimeIst, IST } from "@/lib/format";
import { connection, googleConfigured, recordingAccount } from "@/lib/google";
import { BookingActions } from "@/components/bookings/booking-actions";
import { buttonClass } from "@/components/ui/button";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { ListGroup, PageHeader } from "@/components/ui/page-header";
import { EmptyState, InlineNote } from "@/components/ui/states";

export const metadata: Metadata = { title: "Client meetings" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const STATE: Record<Exclude<RecordingState, "upcoming">, { label: string; tone: ChipTone }> = {
  live: { label: "Happening now", tone: "bottle" },
  waiting: { label: "Waiting for the recording", tone: "slate" },
  recorded: { label: "Recorded, sheet coming", tone: "slate" },
  sheet: { label: "Sheet ready", tone: "bottle" },
  closed: { label: "Too short for a sheet", tone: "neutral" },
  failed: { label: "Sheet failed", tone: "signal" },
  missing: { label: "No recording", tone: "signal" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: IST, weekday: "short" });
const DATE = new Intl.DateTimeFormat("en-GB", { timeZone: IST, day: "numeric", month: "short" });
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false });

// Client meetings booked from the app: what is coming (join, copy, cancel) and what became of the
// ones that happened (recorded, sheet ready, no recording). Admins connect the recording calendar here.
export default async function BookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { person, isAdmin } = await requireUser();
  const now = new Date().getTime();
  const [{ upcoming, past }, connected, params] = await Promise.all([listBookings(now), connection(), searchParams]);
  const configured = googleConfigured();
  const ready = configured && Boolean(connected);
  const google = first(params.google);
  const reason = first(params.reason);

  return (
    <div className="mx-auto max-w-[880px]">
      <PageHeader
        title="Client meetings"
        description={`Booked on ${recordingAccount()}'s calendar, so tl;dv records them and the sheet follows`}
        actions={
          ready && (
            <Link href="/bookings/new" className={buttonClass("primary")}>
              <CalendarPlus size={16} aria-hidden="true" />
              Book a meeting
            </Link>
          )
        }
      />

      {google === "connected" && (
        <InlineNote tone="bottle" title="Google Calendar connected" className="mb-4">
          Meetings are now created on {reason ?? recordingAccount()}&apos;s calendar.
        </InlineNote>
      )}
      {google === "error" && (
        <InlineNote tone="signal" title="Google Calendar wasn't connected" className="mb-4">
          {reason ?? "Try Connect again."}
        </InlineNote>
      )}

      {isAdmin && !configured && (
        <InlineNote tone="signal" title="Google Calendar keys are missing" className="mb-4">
          Add GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET to the app&apos;s environment, then connect the calendar here.
        </InlineNote>
      )}
      {isAdmin && configured && !connected && (
        <InlineNote
          tone="sienna"
          title="Connect Google Calendar to start booking"
          className="mb-4"
          actions={
            <a href="/api/google/connect" className={buttonClass("primary")}>
              Connect Google Calendar
            </a>
          }
        >
          Meetings are created on {recordingAccount()}&apos;s calendar so tl;dv&apos;s bot joins and records them. On Google&apos;s page, sign in as {recordingAccount()}.
        </InlineNote>
      )}
      {!isAdmin && !ready && (
        <InlineNote title="Booking isn't open yet" className="mb-4">
          An admin connects the recording calendar first; then you can book client meetings here.
        </InlineNote>
      )}

      {upcoming.length === 0 && past.length === 0 ? (
        <EmptyState
          title="No client meetings booked yet."
          action={
            ready && (
              <Link href="/bookings/new" className={buttonClass("secondary")}>
                Book the first one
              </Link>
            )
          }
        >
          Booking here sends the invites from {recordingAccount()} with a Google Meet link, so the meeting is recorded and its sheet appears on its own.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <ListGroup title="Coming up" count={upcoming.length}>
            {upcoming.length === 0 ? (
              <li className="px-4 py-3.5 text-[14px] text-ink-3">Nothing booked ahead.</li>
            ) : (
              upcoming.map((b) => <BookingRow key={b.id} booking={b} canCancel={b.state === "upcoming" && (isAdmin || b.bookedBy?.id === person.id || b.attendeeIds.includes(person.id))} />)
            )}
          </ListGroup>
          {past.length > 0 && (
            <ListGroup title="Last 60 days" count={past.length}>
              {past.map((b) => (
                <BookingRow key={b.id} booking={b} canCancel={false} />
              ))}
            </ListGroup>
          )}
        </div>
      )}

      {isAdmin && connected && (
        <p className="mt-6 text-[12px] leading-4 text-ink-3">
          Invites come from {connected.email}, connected {formatDateTimeIst(connected.connectedAt)}.{" "}
          <a href="/api/google/connect" className="text-ink-2 underline decoration-strong underline-offset-2 hover:text-ink">
            Reconnect
          </a>
        </p>
      )}
    </div>
  );
}

function BookingRow({ booking: b, canCancel }: { booking: BookingListRow; canCancel: boolean }) {
  const start = new Date(b.startsAt);
  const people = b.attendees.map((a) => a.name.split(" ")[0]).join(", ");
  const state = b.state === "upcoming" ? null : STATE[b.state];
  const ahead = b.state === "upcoming" || b.state === "live";
  return (
    <li className="grid grid-cols-[56px_1fr] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[56px_1fr_auto]">
      <div className={`text-center font-mono leading-tight tnum ${b.state === "cancelled" ? "text-ink-3 line-through" : "text-ink"}`}>
        <p className="text-[11px] uppercase text-ink-3">{DAY.format(start)}</p>
        <p className="text-[13px] font-medium">{DATE.format(start)}</p>
        <p className="text-[12px] text-ink-2">{TIME.format(start)}</p>
      </div>
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-2">
          {b.clientId ? (
            <Link href={`/clients/${b.clientId}`} className="truncate text-[15px] font-medium text-ink hover:underline lg:text-[14px]">
              {b.clientName}
            </Link>
          ) : (
            <span className="truncate text-[15px] font-medium text-ink lg:text-[14px]">{b.clientName}</span>
          )}
          {state && <Chip tone={state.tone}>{state.label}</Chip>}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-ink-3">
          {b.durationMin} min · {people || "no one from DNY"}
          {b.bookedBy && ` · booked by ${b.bookedBy.name.split(" ")[0]}`}
        </p>
      </div>
      <div className="col-span-2 flex justify-end sm:col-span-1">
        {ahead ? (
          <BookingActions id={b.id} meetUrl={b.meetUrl} clientName={b.clientName} when={formatDateTimeIst(b.startsAt)} canCancel={canCancel} />
        ) : b.meetingId ? (
          <Link href={`/meetings/${b.meetingId}`} className={buttonClass("ghost", "sm")}>
            {b.state === "sheet" ? "Open sheet" : "Open meeting"}
          </Link>
        ) : null}
      </div>
    </li>
  );
}
