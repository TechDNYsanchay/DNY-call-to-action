// Client meetings booked from the app, the same way Sales QA books vision calls. The Google Calendar
// event goes on the recording account's calendar (it organises; the client's people and DNY's
// people are guests), so tl;dv's bot records it, and the Meet code tl;dv sends back ties the
// recording to its booking and its client. Pure: no I/O, safe in client components.

import { DNY_EMAIL_DOMAIN } from "@/lib/env";
import { IST } from "@/lib/format";

export const DURATIONS = [30, 45, 60, 90, 120] as const;
export const DEFAULT_DURATION = 60;
/** Meetings can be booked this far ahead. */
const MAX_DAYS_AHEAD = 120;
const MAX_CLIENT_EMAILS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i;

/** The title marks it as a client meeting for the sorting in both apps. Never "vision call" here. */
export const meetingTitle = (clientName: string) => `Client meeting: ${clientName} × DNY Hospitality`;

/** "Vision call" in a meeting title (any spacing or hyphen) marks a sales meeting, which Sales QA takes. */
export const isSalesTitle = (title: string | null | undefined) => /\bvision[\s-]*call\b/i.test(title ?? "");

/** A title starting "Client meeting" is one booked here (or named the same way by hand). */
export const isClientTitle = (title: string | null | undefined) => /^\s*client[\s-]*meeting\b/i.test(title ?? "");

/** "a@x.com, B@Y.com\nc@z.in" -> ["a@x.com", "b@y.com", "c@z.in"], in order, without repeats. */
export function splitEmails(value: string): string[] {
  const all = value
    .split(/[\s,;]+/)
    .map((e) => e.trim().replace(/^<|>$/g, "").toLowerCase())
    .filter(Boolean);
  return [...new Set(all)];
}

export const isDnyEmail = (email: string) => email.toLowerCase().endsWith(`@${DNY_EMAIL_DOMAIN}`);

export interface BookingForm {
  clientName: string;
  clientEmails: string;
  date: string;
  time: string;
  durationMin: string | number;
  attendeeIds: string[];
  notes?: string;
}

export interface BookingRequest {
  clientName: string;
  /** Every address typed for the client, lower case; at least one is outside DNY. */
  clientEmails: string[];
  /** ISO timestamp with the IST offset. */
  startsAt: string;
  durationMin: number;
  attendeeIds: string[];
  notes: string | null;
}

export type BookingField = "clientName" | "clientEmails" | "date" | "time" | "durationMin" | "attendeeIds" | "notes" | "form";
export type FieldErrors = Partial<Record<BookingField, string>>;

/** Checks the booking form; the meeting must start at least 5 minutes after `nowMs` and within 120 days. */
export function parseBookingForm(form: BookingForm, nowMs: number): { ok: true; value: BookingRequest } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const clientName = form.clientName.trim().replace(/\s+/g, " ");
  if (clientName.length < 2) errors.clientName = "Add the client's name";
  else if (clientName.length > 80) errors.clientName = "Keep the client's name under 80 characters";
  else if (isSalesTitle(clientName)) errors.clientName = 'A client meeting can\'t mention "vision call": Sales QA would take it as a sales meeting';

  const clientEmails = splitEmails(form.clientEmails);
  const bad = clientEmails.find((e) => !EMAIL.test(e));
  if (!clientEmails.length) errors.clientEmails = "Add the client's email";
  else if (bad) errors.clientEmails = `Check "${bad}"`;
  else if (clientEmails.length > MAX_CLIENT_EMAILS) errors.clientEmails = `Invite at most ${MAX_CLIENT_EMAILS} people from the client`;
  else if (clientEmails.every(isDnyEmail)) errors.clientEmails = "Add at least one address outside DNY: meetings with only DNY addresses aren't recorded";

  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(form.date);
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(form.time);
  if (!dateOk) errors.date = "Pick a date";
  if (!timeOk) errors.time = "Pick a time";

  const durationMin = Number(form.durationMin);
  if (!(DURATIONS as readonly number[]).includes(durationMin)) errors.durationMin = "Pick a length";

  const attendeeIds = [...new Set(form.attendeeIds)];
  if (!attendeeIds.length) errors.attendeeIds = "Pick who from DNY will attend";
  else if (attendeeIds.some((id) => !UUID.test(id))) errors.attendeeIds = "Pick people from the team list";

  const notes = (form.notes ?? "").trim();
  if (notes.length > 500) errors.notes = "Keep the note under 500 characters";

  if (Object.keys(errors).length) return { ok: false, errors };

  const startsAt = `${form.date}T${form.time}:00+05:30`;
  const startMs = Date.parse(startsAt);
  if (Number.isNaN(startMs)) return { ok: false, errors: { date: "Pick a date" } };
  if (startMs < nowMs + 5 * 60_000) return { ok: false, errors: { time: "Pick a time at least 5 minutes from now" } };
  if (startMs > nowMs + MAX_DAYS_AHEAD * 86_400_000) return { ok: false, errors: { date: "Pick a date within the next four months" } };
  return { ok: true, value: { clientName, clientEmails, startsAt, durationMin, attendeeIds, notes: notes || null } };
}

export interface Guest {
  email: string;
  name: string | null;
}

/**
 * The Google Calendar event (Events: insert, with conferenceDataVersion=1): a Google Meet link,
 * invites to the client and DNY's people, and a line telling everyone the meeting is recorded.
 */
export function calendarEvent(b: { bookingId: string; clientName: string; startsAt: string; durationMin: number; guests: Guest[]; notes: string | null }) {
  const start = new Date(b.startsAt);
  const end = new Date(start.getTime() + b.durationMin * 60_000);
  const description = [`A meeting between ${b.clientName} and DNY Hospitality.`, b.notes, "This meeting is recorded and transcribed so we can follow up accurately."].filter(Boolean).join("\n\n");
  return {
    summary: meetingTitle(b.clientName),
    description,
    start: { dateTime: start.toISOString(), timeZone: IST },
    end: { dateTime: end.toISOString(), timeZone: IST },
    attendees: dedupeGuests(b.guests).map((g) => ({ email: g.email, ...(g.name ? { displayName: g.name } : {}) })),
    guestsCanInviteOthers: false,
    conferenceData: { createRequest: { requestId: b.bookingId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
  };
}

function dedupeGuests(guests: Guest[]): Guest[] {
  const seen = new Set<string>();
  return guests.filter((g) => {
    const key = g.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const WHEN = new Intl.DateTimeFormat("en-GB", { timeZone: IST, weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/** "2026-11-13T11:00:00+05:30" -> "Thursday 13 Nov at 11 am"; "…T15:30…" -> "… at 3:30 pm" (IST). */
export function whenText(startsAt: string): string {
  const parts = Object.fromEntries(WHEN.formatToParts(new Date(startsAt)).map((p) => [p.type, p.value]));
  const minutes = parts.minute === "00" ? "" : `:${parts.minute}`;
  return `${parts.weekday} ${parts.day} ${parts.month} at ${parts.hour}${minutes} ${(parts.dayPeriod ?? "").toLowerCase()}`.trim();
}

/** The WhatsApp message with the meeting link, for the booker to send the client. */
export function meetingLinkMessage(startsAt: string, meetUrl: string): string {
  return `Hi, our meeting with DNY Hospitality is fixed for ${whenText(startsAt)} (IST). Join here: ${meetUrl} You'll also get a calendar invite by email. – DNY Hospitality`;
}

/** WhatsApp's share link: opens WhatsApp with the message ready, for the booker to pick the chat. */
export const whatsappShareLink = (message: string) => `https://wa.me/?text=${encodeURIComponent(message)}`;

/** The IST date and the next half hour from `nowMs`, as the form's starting values. */
export function nextSlot(nowMs: number): { date: string; time: string } {
  const slotMs = Math.ceil((nowMs + 15 * 60_000) / 1_800_000) * 1_800_000;
  const ist = new Date(slotMs + 5.5 * 3_600_000).toISOString();
  return { date: ist.slice(0, 10), time: ist.slice(11, 16) };
}

/** What became of a booked meeting, for the bookings list. */
export type RecordingState = "cancelled" | "upcoming" | "live" | "waiting" | "recorded" | "sheet" | "closed" | "failed" | "missing";

/** How long after a meeting ends tl;dv's recording is still expected before "No recording" shows. */
const RECORDING_GRACE_MS = 6 * 3_600_000;

export function recordingState(b: { status: string; startsAt: string; durationMin: number; meetingStatus: string | null; hasMeeting: boolean }, nowMs: number): RecordingState {
  if (b.status === "cancelled") return "cancelled";
  const start = Date.parse(b.startsAt);
  const end = start + b.durationMin * 60_000;
  if (b.hasMeeting) {
    if (b.meetingStatus === "done") return "sheet";
    if (b.meetingStatus === "skipped") return "closed";
    if (b.meetingStatus === "failed") return "failed";
    return "recorded";
  }
  if (nowMs < start) return "upcoming";
  if (nowMs < end) return "live";
  return nowMs < end + RECORDING_GRACE_MS ? "waiting" : "missing";
}
