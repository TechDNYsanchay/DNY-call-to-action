import { describe, expect, it } from "vitest";
import { applyRules, describeOutsiders, domainOf, GENERIC_DOMAINS, isGenericDomain, matchClient, MIN_DURATION_SEC, MIN_SENTENCES, type ClientLike } from "./rules";

const sunrise: ClientLike = { id: "c1", name: "Hotel Sunrise", domains: ["hotelsunrise.in"], contact_emails: ["sunita.agarwal@gmail.com"] };
const bluefin: ClientLike = { id: "c2", name: "Bluefin Resorts", domains: ["Bluefin.co.in"], contact_emails: [] };
const clients = [sunrise, bluefin];

const dny = [
  { email: "priya@dnyhospitality.com", name: "Priya Nair" },
  { email: "arjun@dnyhospitality.com", name: "Arjun Mehta" },
];

describe("generic domains", () => {
  it("lists the personal mailbox providers", () => {
    expect(GENERIC_DOMAINS).toContain("gmail.com");
    expect(GENERIC_DOMAINS).toContain("yahoo.*");
    expect(GENERIC_DOMAINS).toContain("rediffmail.com");
  });
  it("matches exact domains and yahoo.* variants, case-insensitively", () => {
    expect(isGenericDomain("gmail.com")).toBe(true);
    expect(isGenericDomain("GMAIL.COM")).toBe(true);
    expect(isGenericDomain("yahoo.com")).toBe(true);
    expect(isGenericDomain("yahoo.co.in")).toBe(true);
    expect(isGenericDomain("hotelsunrise.in")).toBe(false);
    expect(isGenericDomain("notgmail.com")).toBe(false);
    expect(isGenericDomain(null)).toBe(false);
  });
  it("extracts domains", () => {
    expect(domainOf("Rakesh@HotelSunrise.in")).toBe("hotelsunrise.in");
    expect(domainOf("broken")).toBeNull();
    expect(domainOf(null)).toBeNull();
  });
});

describe("matchClient", () => {
  it("matches a contact email even on a generic domain", () => {
    const m = matchClient([{ email: "Sunita.Agarwal@gmail.com" }], clients);
    expect(m?.client.id).toBe("c1");
    expect(m?.matchedBy).toBe("email");
  });
  it("matches a client domain case-insensitively", () => {
    const m = matchClient([{ email: "gm@bluefin.co.in" }], clients);
    expect(m?.client.id).toBe("c2");
    expect(m?.matchedBy).toBe("domain");
    expect(m?.value).toBe("bluefin.co.in");
  });
  it("never matches a generic domain put on a client record by mistake", () => {
    const sloppy: ClientLike = { id: "c3", name: "Sloppy", domains: ["gmail.com"], contact_emails: [] };
    expect(matchClient([{ email: "someone@gmail.com" }], [sloppy])).toBeNull();
  });
  it("returns null for DNY-only or unknown participants", () => {
    expect(matchClient(dny, clients)).toBeNull();
    expect(matchClient([{ email: "x@acme.com" }], clients)).toBeNull();
    expect(matchClient([{ email: null }], clients)).toBeNull();
  });
});

describe("applyRules", () => {
  it("rule A: a short recording is 'other', decided", () => {
    const r = applyRules({ durationSec: MIN_DURATION_SEC - 1, sentenceCount: null, participants: [...dny, { email: "rakesh@hotelsunrise.in" }], clients });
    expect(r).toMatchObject({ type: "other", decided: true, rule: "A", confidence: 0.95, clientId: null });
    expect(r.reason).toBe("Recording is only 5 min long; too short to be a real meeting.");
  });
  it("rule A: a thin transcript is 'other' even with a client on the invite", () => {
    const r = applyRules({ durationSec: 1800, sentenceCount: MIN_SENTENCES - 1, participants: [{ email: "rakesh@hotelsunrise.in" }], clients });
    expect(r.rule).toBe("A");
    expect(r.reason).toBe("Transcript has only 39 sentences; too short to be a real meeting.");
  });
  it("rule A: an unknown duration (0) does not count as short", () => {
    const r = applyRules({ durationSec: 0, sentenceCount: null, participants: [{ email: "rakesh@hotelsunrise.in" }], clients });
    expect(r.rule).toBe("B");
  });
  it("rule A: exactly 40 sentences and 300 s pass", () => {
    const r = applyRules({ durationSec: 300, sentenceCount: 40, participants: dny, clients });
    expect(r.rule).toBeNull();
  });
  it("rule B: a client domain decides 'client' with the client id", () => {
    const r = applyRules({ durationSec: 2700, sentenceCount: 120, participants: [...dny, { email: "rakesh@hotelsunrise.in" }, { email: "ops@hotelsunrise.in" }], clients });
    expect(r).toMatchObject({ type: "client", decided: true, rule: "B", clientId: "c1", confidence: 0.95 });
    expect(r.reason).toBe("hotelsunrise.in is Hotel Sunrise's domain (2 people on the invite).");
  });
  it("rule B: a contact email decides 'client'", () => {
    const r = applyRules({ durationSec: 2700, sentenceCount: 120, participants: [...dny, { email: "sunita.agarwal@gmail.com" }], clients });
    expect(r.clientId).toBe("c1");
    expect(r.reason).toBe("sunita.agarwal@gmail.com is on Hotel Sunrise's contact list.");
  });
  it("otherwise 'unknown' at 0.5, undecided, with a readable reason", () => {
    const r = applyRules({ durationSec: 2700, sentenceCount: 120, participants: [...dny, { email: "a@gmail.com" }, { email: "b@gmail.com" }], clients });
    expect(r).toMatchObject({ type: "unknown", decided: false, rule: null, confidence: 0.5, clientId: null });
    expect(r.reason).toBe("2 people from gmail.com, none on the client list.");
  });
  it("a DNY-only invite is still undecided (clients join from forwarded links)", () => {
    const r = applyRules({ durationSec: 2700, sentenceCount: 120, participants: dny, clients });
    expect(r.decided).toBe(false);
    expect(r.reason).toBe("Everyone on the invite is from DNY; the client may have joined from a forwarded link or by phone.");
  });
});

describe("describeOutsiders", () => {
  it("lists domains by count and mentions people without an email", () => {
    expect(describeOutsiders([{ email: "a@acme.com" }, { email: "b@gmail.com" }, { email: "c@gmail.com" }, { email: null }])).toBe(
      "2 people from gmail.com and 1 from acme.com, plus 1 person without an email, none on the client list.",
    );
    expect(describeOutsiders([{ email: "a@acme.com" }])).toBe("1 person from acme.com, none on the client list.");
    expect(describeOutsiders([{ email: "a@a.com" }, { email: "b@b.com" }, { email: "c@c.com" }])).toBe("1 person from a.com, 1 from b.com and 1 from c.com, none on the client list.");
  });
  it("explains an empty invite", () => {
    expect(describeOutsiders([])).toBe("No participant emails were shared; the client may have joined from a forwarded link or by phone.");
  });
});

describe("booked and named meetings", () => {
  const guest = [...dny, { email: "rakesh@hotelsunrise.in", name: "Rakesh" }];
  const stranger = [...dny, { email: "someone@unknown.co", name: "Someone" }];
  const base = { durationSec: 45 * 60, sentenceCount: null, clients };

  it("takes a meeting booked here as a client meeting with the booking's client", () => {
    const r = applyRules({ ...base, participants: stranger, booking: { clientId: "c9" }, title: "Vision call: Ravi × DNY Hospitality" });
    expect(r).toMatchObject({ type: "client", decided: true, rule: "booking", clientId: "c9", source: "rule" });
  });

  it("falls back to the invite for a booking whose client was removed", () => {
    expect(applyRules({ ...base, participants: guest, booking: { clientId: null } })).toMatchObject({ type: "client", rule: "booking", clientId: "c1" });
  });

  it("still closes a booked meeting with no content (a no-show)", () => {
    expect(applyRules({ ...base, durationSec: 90, participants: guest, booking: { clientId: "c1" } })).toMatchObject({ type: "other", rule: "A", decided: true });
  });

  it("leaves vision calls to Sales QA, even with a known client invited", () => {
    const r = applyRules({ ...base, participants: guest, title: "Vision call: Sunrise × DNY Hospitality" });
    expect(r).toMatchObject({ type: "sales", decided: true, rule: "title", clientId: null });
    expect(r.reason).toMatch(/Sales QA/);
  });

  it("takes a 'Client meeting' title as a client meeting, with the client when one is invited", () => {
    expect(applyRules({ ...base, participants: guest, title: "Client meeting: Sunrise × DNY Hospitality" })).toMatchObject({ type: "client", rule: "title", clientId: "c1" });
    expect(applyRules({ ...base, participants: stranger, title: "Client meeting: New Co × DNY Hospitality" })).toMatchObject({ type: "client", rule: "title", clientId: null, decided: true });
  });

  it("keeps the old rules for everything else", () => {
    expect(applyRules({ ...base, participants: guest, title: "Weekly sync" })).toMatchObject({ type: "client", rule: "B" });
    expect(applyRules({ ...base, participants: stranger, title: "Weekly sync" })).toMatchObject({ type: "unknown", decided: false });
  });
});
