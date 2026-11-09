"use client";

import { ArrowLeft, Check, Copy, VideoCamera, WhatsappLogo } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { bookClientMeeting, type Booked } from "@/app/(app)/bookings/actions";
import { DEFAULT_DURATION, DURATIONS, type FieldErrors } from "@/lib/booking";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/fields";
import { Checkbox } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

// Book a client meeting: the client (picked from the list or typed new), their addresses, when, who
// from DNY, a note. On success the Meet link is shown with Copy and WhatsApp, ready to send.

export interface BookingClientOption {
  id: string;
  name: string;
  contactEmails: string[];
}

export interface BookingPersonOption {
  id: string;
  name: string;
  email: string;
}

const lengthLabel = (min: number) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`);

export function BookingForm({ clients, people, meId, start }: { clients: BookingClientOption[]; people: BookingPersonOption[]; meId: string; start: { date: string; time: string } }) {
  const [clientName, setClientName] = useState("");
  const [emails, setEmails] = useState("");
  const [attendees, setAttendees] = useState<Set<string>>(() => new Set(people.some((p) => p.id === meId) ? [meId] : []));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [booked, setBooked] = useState<Booked | null>(null);
  const [pending, startTransition] = useTransition();
  const byName = useMemo(() => new Map(clients.map((c) => [c.name.trim().toLowerCase(), c])), [clients]);
  const known = byName.get(clientName.trim().toLowerCase()) ?? null;

  // Picking a known client fills in its contacts, unless addresses were already typed.
  const onClientName = (value: string) => {
    setClientName(value);
    const match = byName.get(value.trim().toLowerCase());
    if (match && !emails.trim() && match.contactEmails.length) setEmails(match.contactEmails.join(", "));
  };

  const toggle = (id: string, on: boolean) =>
    setAttendees((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const submit = (form: FormData) =>
    startTransition(async () => {
      setErrors({});
      const result = await bookClientMeeting({
        clientName,
        clientEmails: emails,
        date: String(form.get("date") ?? ""),
        time: String(form.get("time") ?? ""),
        durationMin: String(form.get("durationMin") ?? DEFAULT_DURATION),
        attendeeIds: [...attendees],
        notes: String(form.get("notes") ?? ""),
      });
      if (result.ok) setBooked(result.booked);
      else setErrors(result.errors);
    });

  if (booked) return <BookedPanel booked={booked} />;

  return (
    <form action={submit} className="card flex flex-col gap-5 p-5 sm:p-6" noValidate>
      <Field label="Client" htmlFor="booking-client" error={errors.clientName} hint={known ? `On the client list${known.contactEmails.length ? `, ${known.contactEmails.length} contact${known.contactEmails.length === 1 ? "" : "s"} known` : ""}.` : clientName.trim().length > 1 ? "New client: it is added to the client list when you book." : "Pick from the list or type a new client's name."}>
        <Input id="booking-client" list="booking-clients" value={clientName} onChange={(e) => onClientName(e.target.value)} invalid={Boolean(errors.clientName)} autoComplete="off" maxLength={80} required autoFocus />
        <datalist id="booking-clients">
          {clients.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
      </Field>

      <Field label="Client's email" htmlFor="booking-emails" error={errors.clientEmails} hint="One or more, separated by commas. At least one must be outside DNY, or tl;dv won't record the meeting.">
        <Input id="booking-emails" type="text" inputMode="email" value={emails} onChange={(e) => setEmails(e.target.value)} invalid={Boolean(errors.clientEmails)} autoComplete="off" placeholder="name@client.com" required />
      </Field>

      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_140px]">
        <Field label="Date (IST)" htmlFor="booking-date" error={errors.date}>
          <Input id="booking-date" name="date" type="date" defaultValue={start.date} min={start.date} invalid={Boolean(errors.date)} required />
        </Field>
        <Field label="Time (IST)" htmlFor="booking-time" error={errors.time}>
          <Input id="booking-time" name="time" type="time" defaultValue={start.time} step={900} invalid={Boolean(errors.time)} required />
        </Field>
        <Field label="Length" htmlFor="booking-length" error={errors.durationMin}>
          <NativeSelect id="booking-length" name="durationMin" defaultValue={DEFAULT_DURATION}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {lengthLabel(d)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[13px] font-medium text-ink">From DNY</legend>
        <p className="text-[12px] leading-4 text-ink-3">Everyone ticked gets the invite.</p>
        <ul className="mt-1 grid max-h-[264px] overflow-y-auto rounded-chip border border-hairline sm:grid-cols-2" aria-describedby={errors.attendeeIds ? "booking-attendees-error" : undefined}>
          {people.map((p) => (
            <li key={p.id} className="flex min-w-0 items-center gap-1 pr-3">
              <Checkbox checked={attendees.has(p.id)} onCheckedChange={(on) => toggle(p.id, on)} label={p.name} />
              <button type="button" onClick={() => toggle(p.id, !attendees.has(p.id))} className="min-w-0 py-2 text-left">
                <span className="block truncate text-[14px] text-ink">
                  {p.name}
                  {p.id === meId && <span className="text-ink-3"> (you)</span>}
                </span>
                <span className="block truncate font-mono text-[11px] text-ink-3">{p.email}</span>
              </button>
            </li>
          ))}
        </ul>
        {errors.attendeeIds && (
          <p id="booking-attendees-error" role="alert" className="text-[12px] leading-4 text-signal">
            {errors.attendeeIds}
          </p>
        )}
      </fieldset>

      <Field label="Note (optional)" htmlFor="booking-notes" error={errors.notes} hint="Goes into the invite, e.g. the agenda.">
        <Textarea id="booking-notes" name="notes" maxLength={500} className="min-h-[72px] font-sans text-[14px]" />
      </Field>

      {errors.form && (
        <p role="alert" className="rounded-chip bg-signal-tint px-3 py-2 text-[13px] leading-[18px] text-signal">
          {errors.form}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-hairline pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] leading-4 text-ink-3">The invite comes from the recording account, so tl;dv records the meeting and its sheet follows.</p>
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="shrink-0">
          <VideoCamera size={18} aria-hidden="true" />
          {pending ? "Booking…" : "Book and send invites"}
        </Button>
      </div>
    </form>
  );
}

function BookedPanel({ booked }: { booked: Booked }) {
  const toast = useToast();
  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  const copy = async (what: "link" | "message") => {
    try {
      await navigator.clipboard.writeText(what === "link" ? booked.meetUrl : booked.message);
      setCopied(what);
      toast({ message: what === "link" ? "Meet link copied" : "Message copied" });
    } catch {
      toast({ message: "Couldn't copy; select the link instead" });
    }
  };

  return (
    <section className="card overflow-hidden" aria-labelledby="booked-title">
      <div className="flex items-start gap-3 border-b border-hairline p-5 sm:p-6">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-bottle text-sheet">
          <Check size={16} weight="bold" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="booked-title" className="text-[17px] font-semibold text-ink">
            Booked with {booked.clientName}
          </h2>
          <p className="mt-0.5 text-[14px] text-ink-2">{booked.when} IST. Invites are on their way by email.</p>
        </div>
      </div>
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div>
          <p className="label-xs">Google Meet link</p>
          <div className="mt-1.5 flex items-center gap-2 rounded-chip border border-hairline bg-inset px-3 py-2.5">
            <a href={booked.meetUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-[14px] text-ink underline decoration-strong underline-offset-2">
              {booked.meetUrl.replace(/^https:\/\//, "")}
            </a>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => copy("link")}>
            {copied === "link" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            Copy link
          </Button>
          <a href={booked.whatsapp} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
            <WhatsappLogo size={16} aria-hidden="true" />
            Send on WhatsApp
          </a>
          <Button variant="ghost" onClick={() => copy("message")}>
            {copied === "message" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            Copy message
          </Button>
        </div>
        <p className="rounded-chip bg-inset px-3 py-2.5 text-[13px] leading-[19px] text-ink-2">{booked.message}</p>
        <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
          <Link href="/bookings" className={buttonClass("secondary")}>
            <ArrowLeft size={16} aria-hidden="true" />
            All client meetings
          </Link>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            Book another
          </Button>
        </div>
      </div>
    </section>
  );
}
