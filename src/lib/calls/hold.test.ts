import { describe, expect, it } from "vitest";
import { budgetAlertText, HOLD_TEXT, heldText, holdReasonFor, isKnownBusinessName, knownBusinessReason, percentOf, unsureText } from "./hold";

const base = { previouslyBusiness: null, savedName: null, clientNames: ["Cafe 89", "Saffron Court Hotel"], routinePurgesLastHour: 0, budgetPerHour: 4 };

describe("holdReasonFor", () => {
  it("lets a confident answer through when nothing looks risky", () => {
    expect(holdReasonFor(base)).toBeNull();
    expect(holdReasonFor({ ...base, savedName: "Mummy", routinePurgesLastHour: 3 })).toBeNull();
  });
  it("checks a known number first, then a client's name, then the hourly budget", () => {
    const everything = { ...base, previouslyBusiness: { type: "client" as const, client: "Cafe 89" }, savedName: "Rakesh Cafe 89", routinePurgesLastHour: 9 };
    expect(holdReasonFor(everything)).toBe("known_number");
    expect(holdReasonFor({ ...everything, previouslyBusiness: null })).toBe("known_name");
    expect(holdReasonFor({ ...everything, previouslyBusiness: null, savedName: "Mummy" })).toBe("budget");
    expect(holdReasonFor({ ...base, previouslyBusiness: { type: "vendor", client: null } })).toBe("known_number");
  });
  it("holds once the routine has used the hour's budget", () => {
    expect(holdReasonFor({ ...base, routinePurgesLastHour: 4 })).toBe("budget");
    expect(holdReasonFor({ ...base, routinePurgesLastHour: 1, budgetPerHour: 1 })).toBe("budget");
    expect(holdReasonFor({ ...base, routinePurgesLastHour: 0, budgetPerHour: 0 })).toBe("budget");
  });
  it("has a sentence for every reason", () => {
    for (const reason of ["budget", "known_number", "known_name"] as const) expect(HOLD_TEXT[reason]).toMatch(/^[a-z]/);
  });
});

describe("knownBusinessReason", () => {
  it("names a known number before a client's name, and never the budget", () => {
    const party = { previouslyBusiness: null, savedName: "Rakesh Cafe 89", clientNames: ["Cafe 89"] };
    expect(knownBusinessReason({ ...party, previouslyBusiness: { type: "vendor", client: null } })).toBe("known_number");
    expect(knownBusinessReason(party)).toBe("known_name");
    expect(knownBusinessReason({ ...party, savedName: "Mummy" })).toBeNull();
    // The budget is for sure answers only: an unsure answer never meets it here.
    expect(holdReasonFor({ ...party, savedName: "Mummy", routinePurgesLastHour: 9, budgetPerHour: 4 })).toBe("budget");
  });
});

describe("isKnownBusinessName", () => {
  it("finds a client's name inside the saved contact name", () => {
    expect(isKnownBusinessName("Rakesh Cafe 89", ["Cafe 89"])).toBe(true);
    expect(isKnownBusinessName("Manager (Saffron Court Hotel)", ["Cafe 89", "Saffron Court Hotel"])).toBe(true);
  });
  it("ignores punctuation and case", () => {
    expect(isKnownBusinessName("rakesh - CAFE-89", ["Cafe 89"])).toBe(true);
    expect(isKnownBusinessName("Rakesh, Café", ["café"])).toBe(true);
  });
  it("ignores client names under 4 characters and missing names", () => {
    expect(isKnownBusinessName("Taj Mahal Tea House", ["Taj"])).toBe(false);
    expect(isKnownBusinessName("A B C Traders", ["A B C"])).toBe(false);
    expect(isKnownBusinessName(null, ["Cafe 89"])).toBe(false);
    expect(isKnownBusinessName("Rakesh", [])).toBe(false);
    expect(isKnownBusinessName("Rakesh", ["Cafe 89"])).toBe(false);
  });
});

describe("the texts a hold stores", () => {
  it("say why a call waits for a person, in fixed words", () => {
    expect(heldText("known_number")).toBe("Held for a person: this number had a client or vendor call before");
    expect(heldText("budget")).toBe("Held for a person: more calls than usual were marked not work calls this hour");
    expect(percentOf(0.6)).toBe("60%");
    expect(percentOf(0.925)).toBe("93%");
  });
  it("tell when an unsure call is deleted, in IST", () => {
    // 05:30 UTC is 11:00 IST; 24 hours later is 11:00 on the 22nd.
    expect(unsureText(0.6, 24, new Date("2026-11-21T05:30:00Z"))).toBe(
      "The routine was not sure this is a work call (60%). It is deleted at 11:00, 22 Nov unless someone decides.",
    );
    // 16:00 UTC is 21:30 IST; 4 hours later is 01:30 on the 1st of the next month.
    expect(unsureText(0.4, 4, new Date("2026-11-30T16:00:00Z"))).toContain("deleted at 01:30, 1 Dec");
  });
  it("count the held calls in the hourly alert", () => {
    expect(budgetAlertText(1)).toBe("Routine purges paused for an hour: 1 call held for a person");
    expect(budgetAlertText(3)).toBe("Routine purges paused for an hour: 3 calls held for a person");
  });
});
