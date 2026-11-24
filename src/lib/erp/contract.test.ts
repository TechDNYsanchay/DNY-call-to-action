import { describe, expect, it } from "vitest";

import { bookingRequest, evidenceLine, goesToErp, MAX_BOOKINGS_PER_READ, parseBookingIds, parseSince } from "./contract";

describe("parseSince", () => {
  const now = Date.parse("2026-11-24T07:00:00Z");
  it("asks back the default when Sync sends nothing, and takes a date it sends", () => {
    const d = parseSince(null, now);
    expect(d.ok && d.since.toISOString()).toBe("2026-11-10T07:00:00.000Z");
    const s = parseSince("2026-11-20T00:00:00Z", now);
    expect(s.ok && s.since.toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });

  it("holds a date to the last 30 days and refuses what is not one", () => {
    const old = parseSince("2025-01-01", now);
    expect(old.ok && old.since.toISOString()).toBe("2026-10-25T07:00:00.000Z");
    expect(parseSince("yesterday", now).ok).toBe(false);
    expect(parseSince("2026-13-45", now).ok).toBe(false);
  });
});

const valid = {
  contract: "1",
  booked_by_email: "Riya@DNYHospitality.com",
  client_name: "Saffron Café",
  client_emails: ["arjun@saffronco.test"],
  date: "2026-12-01",
  time: "15:30",
  duration_min: 60,
  attendee_emails: ["kabir@dnyhospitality.com"],
  notes: null,
};

describe("bookingRequest", () => {
  it("accepts a booking and lower-cases its addresses", () => {
    const r = bookingRequest.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.booked_by_email).toBe("riya@dnyhospitality.com");
  });

  it("refuses another contract, a bad time, and nobody from the client", () => {
    expect(bookingRequest.safeParse({ ...valid, contract: "2" }).success).toBe(false);
    expect(bookingRequest.safeParse({ ...valid, time: "25:00" }).success).toBe(false);
    expect(bookingRequest.safeParse({ ...valid, client_emails: [] }).success).toBe(false);
    expect(bookingRequest.safeParse({ ...valid, attendee_emails: ["not-an-email"] }).success).toBe(false);
  });
});

describe("parseBookingIds", () => {
  it("reads a list of ids, once each, and nothing for nothing", () => {
    const id = "0c0e0b7a-1111-4222-8333-444455556666";
    expect(parseBookingIds(`${id}, ${id}`)).toEqual({ ok: true, ids: [id] });
    expect(parseBookingIds(null)).toEqual({ ok: true, ids: [] });
  });

  it("refuses something that is not an id, and too many", () => {
    expect(parseBookingIds("x'; drop table").ok).toBe(false);
    const many = Array.from({ length: MAX_BOOKINGS_PER_READ + 1 }, (_, i) => `0c0e0b7a-1111-4222-8333-${String(i).padStart(12, "0")}`);
    expect(parseBookingIds(many.join(",")).ok).toBe(false);
  });
});

describe("goesToErp", () => {
  it("sends what DNY owes, alone or with the client, and nothing replaced or the client's alone", () => {
    expect(goesToErp({ owed_by: "dny", status: "open" })).toBe(true);
    expect(goesToErp({ owed_by: "both", status: "in_progress" })).toBe(true);
    expect(goesToErp({ owed_by: "client", status: "open" })).toBe(false);
    expect(goesToErp({ owed_by: "unclear", status: "open" })).toBe(false);
    expect(goesToErp({ owed_by: "dny", status: "superseded" })).toBe(false);
  });
});

describe("evidenceLine", () => {
  it("names the moment and the speaker, and is nothing without a quote", () => {
    expect(evidenceLine({ evidence_ts_sec: 754, evidence_speaker: "Priya", evidence_quote: "We'll send it Friday" })).toBe("[12:34] Priya: “We'll send it Friday”");
    expect(evidenceLine({ evidence_ts_sec: null, evidence_speaker: null, evidence_quote: "Done by Monday" })).toBe("“Done by Monday”");
    expect(evidenceLine({ evidence_ts_sec: 5, evidence_speaker: "A", evidence_quote: "  " })).toBeNull();
  });
});
