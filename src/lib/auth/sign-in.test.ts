import { describe, expect, it } from "vitest";
import {
  destinationAfterSignIn,
  exchangeFailureCode,
  looksLikeEmail,
  otpErrorMessage,
  providerErrorCode,
  readCallback,
  signInErrorMessage,
} from "./sign-in";

describe("readCallback", () => {
  it("prefers a provider error over anything else", () => {
    const input = readCallback(new URLSearchParams({ error: "access_denied", error_description: "Signups not allowed for this instance", code: "abc" }));
    expect(input).toEqual({ kind: "provider_error", code: "no-access" });
  });

  it("recognises a PKCE code", () => {
    expect(readCallback(new URLSearchParams({ code: "34e770dd" }))).toEqual({ kind: "code", code: "34e770dd" });
  });

  it("recognises a magic-link token", () => {
    expect(readCallback(new URLSearchParams({ token_hash: "h4sh", type: "magiclink" }))).toEqual({ kind: "token", tokenHash: "h4sh", type: "magiclink" });
  });

  it("needs both token_hash and type", () => {
    expect(readCallback(new URLSearchParams({ token_hash: "h4sh" }))).toEqual({ kind: "incomplete" });
    expect(readCallback(new URLSearchParams())).toEqual({ kind: "incomplete" });
  });
});

describe("providerErrorCode", () => {
  it("maps closed sign-ups to no-access", () => {
    expect(providerErrorCode("Signups not allowed for this instance")).toBe("no-access");
    expect(providerErrorCode("signup_disabled")).toBe("no-access");
    expect(providerErrorCode("User is banned")).toBe("no-access");
  });

  it("treats everything else as a dead link", () => {
    expect(providerErrorCode("otp_expired")).toBe("link");
    expect(providerErrorCode("Email link is invalid or has expired")).toBe("link");
    expect(providerErrorCode("something odd")).toBe("link");
  });
});

describe("exchangeFailureCode", () => {
  it("blames Google for a failed code exchange and the link for a failed token", () => {
    expect(exchangeFailureCode({ kind: "code", code: "x" })).toBe("google");
    expect(exchangeFailureCode({ kind: "token", tokenHash: "x", type: "email" })).toBe("link");
    expect(exchangeFailureCode({ kind: "incomplete" })).toBe("incomplete");
    expect(exchangeFailureCode({ kind: "provider_error", code: "no-access" })).toBe("no-access");
  });
});

describe("destinationAfterSignIn", () => {
  it("sends team members to the safe next path", () => {
    expect(destinationAfterSignIn(true, "a@dnyhospitality.com", "/meetings/123")).toBe("/meetings/123");
    expect(destinationAfterSignIn(true, "a@dnyhospitality.com", "https://evil.example")).toBe("/meetings");
    expect(destinationAfterSignIn(true, "a@dnyhospitality.com", null)).toBe("/meetings");
  });

  it("sends everyone else to /denied with the address they used", () => {
    expect(destinationAfterSignIn(false, "Someone@Gmail.com", "/meetings")).toBe("/denied?email=someone%40gmail.com");
    expect(destinationAfterSignIn(false, null, "/meetings")).toBe("/denied");
  });
});

describe("signInErrorMessage", () => {
  it("knows the four codes and ignores anything else", () => {
    expect(signInErrorMessage("link")).toMatch(/expired/);
    expect(signInErrorMessage("google")).toMatch(/Google/);
    expect(signInErrorMessage("no-access")).toMatch(/team list/);
    expect(signInErrorMessage("incomplete")).toMatch(/incomplete/);
    expect(signInErrorMessage("<script>")).toBeUndefined();
    expect(signInErrorMessage(null)).toBeUndefined();
  });
});

describe("otpErrorMessage", () => {
  it("explains closed sign-ups as a team-list problem", () => {
    expect(otpErrorMessage({ code: "otp_disabled", message: "Signups not allowed for otp", status: 422 })).toMatch(/team list/);
    expect(otpErrorMessage({ message: "Signups not allowed for otp" })).toMatch(/team list/);
  });

  it("explains rate limits and bad addresses", () => {
    expect(otpErrorMessage({ code: "over_email_send_rate_limit", status: 429 })).toMatch(/Too many/);
    expect(otpErrorMessage({ status: 429 })).toMatch(/Too many/);
    expect(otpErrorMessage({ code: "email_address_invalid" })).toMatch(/valid email/);
    expect(otpErrorMessage({ code: "user_banned" })).toMatch(/deactivated/);
  });

  it("falls back to a calm generic sentence", () => {
    expect(otpErrorMessage({ message: "fetch failed" })).toMatch(/Try again/);
    expect(otpErrorMessage(null)).toMatch(/Try again/);
  });
});

describe("looksLikeEmail", () => {
  it("accepts ordinary addresses and rejects the obvious", () => {
    expect(looksLikeEmail(" tech@dnyhospitality.com ")).toBe(true);
    expect(looksLikeEmail("tech@dnyhospitality")).toBe(false);
    expect(looksLikeEmail("tech dny@x.com")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
  });
});
