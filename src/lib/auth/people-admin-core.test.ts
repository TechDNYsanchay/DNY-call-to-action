import { describe, expect, it } from "vitest";
import { BAN_FOREVER, normaliseEmail, normaliseNewPerson, testLinkUrl } from "./people-admin-core";

describe("normaliseEmail", () => {
  it("lower-cases and trims, matching the people.email check constraint", () => {
    expect(normaliseEmail("  Priya.Shah@DNYHospitality.com ")).toBe("priya.shah@dnyhospitality.com");
  });

  it("refuses things that are not addresses", () => {
    expect(() => normaliseEmail("priya")).toThrow(/not an email/);
    expect(() => normaliseEmail("priya@dny")).toThrow(/not an email/);
    expect(() => normaliseEmail("")).toThrow(/not an email/);
  });
});

describe("normaliseNewPerson", () => {
  it("tidies the name, keeps the role and turns a blank dept into null", () => {
    expect(normaliseNewPerson({ email: "A@B.co", fullName: "  Priya   Shah ", role: "member", dept: "  " })).toEqual({
      email: "a@b.co",
      full_name: "Priya Shah",
      role: "member",
      dept: null,
    });
    expect(normaliseNewPerson({ email: "a@b.co", fullName: "Priya", role: "admin", dept: " Ops " }).dept).toBe("Ops");
    expect(normaliseNewPerson({ email: "a@b.co", fullName: "Priya", role: "admin" }).dept).toBeNull();
  });

  it("insists on a name and a known role", () => {
    expect(() => normaliseNewPerson({ email: "a@b.co", fullName: " ", role: "member" })).toThrow(/full name/);
    expect(() => normaliseNewPerson({ email: "a@b.co", fullName: "Priya", role: "founder" as never })).toThrow(/admin, member/);
  });
});

describe("testLinkUrl", () => {
  it("lands on our own callback with the hashed token and the type", () => {
    expect(testLinkUrl("http://localhost:3200/auth/callback", "abc123")).toBe("http://localhost:3200/auth/callback?token_hash=abc123&type=magiclink");
  });

  it("appends with & when redirectTo already has a query, and escapes the token", () => {
    expect(testLinkUrl("http://localhost:3200/auth/callback?next=%2Fmeetings", "a b", "magiclink")).toBe(
      "http://localhost:3200/auth/callback?next=%2Fmeetings&token_hash=a%20b&type=magiclink",
    );
  });
});

describe("BAN_FOREVER", () => {
  it("is a Go duration gotrue accepts", () => {
    expect(BAN_FOREVER).toMatch(/^\d+h$/);
  });
});
