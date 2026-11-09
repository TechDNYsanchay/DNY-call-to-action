import { describe, expect, it } from "vitest";
import { calendarEvent, isClientTitle, isSalesTitle, meetingLinkMessage, meetingTitle, nextSlot, parseBookingForm, recordingState, splitEmails, whatsappShareLink, whenText, type BookingForm } from "./booking";

const NOW = Date.parse("2026-11-09T06:00:00Z"); // Monday 9 Nov, 11:30 IST
const PRIYA = "11111111-1111-4111-8111-111111111111";
const ARJUN = "22222222-2222-4222-8222-222222222222";

const form = (over: Partial<BookingForm> = {}): BookingForm => ({
  clientName: "  Hotel   Sunrise ",
  clientEmails: "Rakesh@HotelSunrise.in, priya@dnyhospitality.com",
  date: "2026-11-13",
  time: "11:00",
  durationMin: "60",
  attendeeIds: [PRIYA, ARJUN, PRIYA],
  notes: "  Menu review ",
  ...over,
});

describe("titles", () => {
  it("names a client meeting so both apps sort it as one", () => {
    expect(meetingTitle("Hotel Sunrise")).toBe("Client meeting: Hotel Sunrise × DNY Hospitality");
    expect(isClientTitle(meetingTitle("Hotel Sunrise"))).toBe(true);
    expect(isSalesTitle(meetingTitle("Hotel Sunrise"))).toBe(false);
  });

  it("spots Sales QA's vision calls in any spelling", () => {
    for (const t of ["Vision call: Ravi × DNY Hospitality", "vision-call with Ravi", "VISION  CALL"]) expect(isSalesTitle(t)).toBe(true);
    for (const t of ["Revision calls", "Visionary call", null, ""]) expect(isSalesTitle(t)).toBe(false);
  });

  it("only takes a title that starts with Client meeting", () => {
    expect(isClientTitle("client-meeting: Taj")).toBe(true);
    expect(isClientTitle("Prep for the client meeting")).toBe(false);
  });
});

describe("splitEmails", () => {
  it("splits on commas, spaces and new lines, lower-cases and drops repeats", () => {
    expect(splitEmails("A@x.com, b@Y.in\n a@X.com; <c@z.co>")).toEqual(["a@x.com", "b@y.in", "c@z.co"]);
  });
});

describe("parseBookingForm", () => {
  it("accepts a good form and tidies it", () => {
    const parsed = parseBookingForm(form(), NOW);
    expect(parsed).toEqual({
      ok: true,
      value: {
        clientName: "Hotel Sunrise",
        clientEmails: ["rakesh@hotelsunrise.in", "priya@dnyhospitality.com"],
        startsAt: "2026-11-13T11:00:00+05:30",
        durationMin: 60,
        attendeeIds: [PRIYA, ARJUN],
        notes: "Menu review",
      },
    });
  });

  it("needs an address outside DNY, or tl;dv would not record", () => {
    const parsed = parseBookingForm(form({ clientEmails: "priya@dnyhospitality.com" }), NOW);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.clientEmails).toMatch(/outside DNY/);
  });

  it("refuses a client name that would read as a vision call", () => {
    const parsed = parseBookingForm(form({ clientName: "Vision Call Foods" }), NOW);
    expect(!parsed.ok && parsed.errors.clientName).toMatch(/vision call/);
  });

  it("names each bad field", () => {
    const parsed = parseBookingForm(form({ clientName: "", clientEmails: "rakesh@", date: "13/11", time: "25:00", durationMin: "50", attendeeIds: [] }), NOW);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(Object.keys(parsed.errors).sort()).toEqual(["attendeeIds", "clientEmails", "clientName", "date", "durationMin", "time"]);
  });

  it("needs a start at least 5 minutes ahead and within four months", () => {
    const soon = parseBookingForm(form({ date: "2026-11-09", time: "11:30" }), NOW);
    expect(!soon.ok && soon.errors.time).toMatch(/5 minutes/);
    expect(parseBookingForm(form({ date: "2026-11-09", time: "11:45" }), NOW).ok).toBe(true);
    const far = parseBookingForm(form({ date: "2027-04-01" }), NOW);
    expect(!far.ok && far.errors.date).toMatch(/four months/);
  });
});

describe("calendarEvent", () => {
  const event = calendarEvent({
    bookingId: "b-1",
    clientName: "Hotel Sunrise",
    startsAt: "2026-11-13T11:00:00+05:30",
    durationMin: 90,
    guests: [
      { email: "rakesh@hotelsunrise.in", name: null },
      { email: "priya@dnyhospitality.com", name: "Priya Nair" },
      { email: "Rakesh@HotelSunrise.in", name: "dup" },
    ],
    notes: null,
  });

  it("asks Google for a Meet link and invites each guest once", () => {
    expect(event.summary).toBe("Client meeting: Hotel Sunrise × DNY Hospitality");
    expect(event.conferenceData).toEqual({ createRequest: { requestId: "b-1", conferenceSolutionKey: { type: "hangoutsMeet" } } });
    expect(event.attendees).toEqual([{ email: "rakesh@hotelsunrise.in" }, { email: "priya@dnyhospitality.com", displayName: "Priya Nair" }]);
    expect(event.guestsCanInviteOthers).toBe(false);
  });

  it("runs in IST for the booked length and says it is recorded", () => {
    expect(event.start).toEqual({ dateTime: "2026-11-13T05:30:00.000Z", timeZone: "Asia/Kolkata" });
    expect(event.end).toEqual({ dateTime: "2026-11-13T07:00:00.000Z", timeZone: "Asia/Kolkata" });
    expect(event.description).toMatch(/recorded and transcribed/);
  });
});

describe("messages", () => {
  it("writes the time the way people say it, in IST", () => {
    expect(whenText("2026-11-13T11:00:00+05:30")).toBe("Friday 13 Nov at 11 am");
    expect(whenText("2026-11-13T15:30:00+05:30")).toBe("Friday 13 Nov at 3:30 pm");
  });

  it("puts the link in a ready-to-send WhatsApp message", () => {
    const message = meetingLinkMessage("2026-11-13T11:00:00+05:30", "https://meet.google.com/abc-defg-hij");
    expect(message).toBe("Hi, our meeting with DNY Hospitality is fixed for Friday 13 Nov at 11 am (IST). Join here: https://meet.google.com/abc-defg-hij You'll also get a calendar invite by email. – DNY Hospitality");
    expect(whatsappShareLink("a b&c")).toBe("https://wa.me/?text=a%20b%26c");
  });

  it("starts the form at the next half hour, at least 15 minutes away, in IST", () => {
    expect(nextSlot(NOW)).toEqual({ date: "2026-11-09", time: "12:00" });
    expect(nextSlot(Date.parse("2026-11-09T18:20:00Z"))).toEqual({ date: "2026-11-10", time: "00:30" });
  });
});

describe("recordingState", () => {
  const b = { status: "booked", startsAt: "2026-11-09T12:00:00+05:30", durationMin: 60, meetingStatus: null, hasMeeting: false };
  const at = (iso: string) => Date.parse(iso);

  it("follows a booking from coming up to its sheet", () => {
    expect(recordingState(b, at("2026-11-09T11:59:00+05:30"))).toBe("upcoming");
    expect(recordingState(b, at("2026-11-09T12:30:00+05:30"))).toBe("live");
    expect(recordingState(b, at("2026-11-09T14:00:00+05:30"))).toBe("waiting");
    expect(recordingState(b, at("2026-11-09T19:01:00+05:30"))).toBe("missing");
    expect(recordingState({ ...b, hasMeeting: true, meetingStatus: "ready" }, at("2026-11-09T14:00:00+05:30"))).toBe("recorded");
    expect(recordingState({ ...b, hasMeeting: true, meetingStatus: "done" }, at("2026-11-09T14:00:00+05:30"))).toBe("sheet");
    expect(recordingState({ ...b, hasMeeting: true, meetingStatus: "skipped" }, at("2026-11-09T14:00:00+05:30"))).toBe("closed");
    expect(recordingState({ ...b, status: "cancelled" }, at("2026-11-09T11:00:00+05:30"))).toBe("cancelled");
  });
});
