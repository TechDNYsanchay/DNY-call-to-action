import { describe, expect, it } from "vitest";
import { maskCounterpart, maskPhone, nameWithoutNumber, normalizeDigitQuery, redactPhones, toE164Strict } from "./phone";

describe("toE164Strict", () => {
  it("reads Indian numbers in every form Callyzer sends", () => {
    for (const [cc, n] of [
      ["91", "9820123456"],
      [91, 9820123456],
      ["91", "+91 98201 23456"],
      ["91", "09820123456"],
      ["91", "919820123456"],
    ] as const) {
      expect(toE164Strict(cc, n)).toBe("+919820123456");
    }
    expect(toE164Strict("91", "02212345678")).toBe("+912212345678");
    expect(toE164Strict(null, "9820123456")).toBe("+919820123456");
  });
  it("reads other countries", () => {
    expect(toE164Strict("1", "4155550123")).toBe("+14155550123");
  });
  it("rejects short codes, toll-free numbers of the wrong length, and missing numbers", () => {
    expect(toE164Strict("91", "1503")).toBeNull();
    expect(toE164Strict("91", "18001234567")).toBeNull();
    expect(toE164Strict("91", "")).toBeNull();
    expect(toE164Strict("91", "Private")).toBeNull();
    expect(toE164Strict("91", null)).toBeNull();
  });
});

describe("masks", () => {
  it("shows the first two and last three digits of an Indian number", () => {
    expect(maskPhone("+919820123456")).toBe("+91 98••• ••456");
  });
  it("keeps the code's first characters and the last three digits elsewhere", () => {
    expect(maskPhone("+14155550123")).toBe("+14 ••• ••123");
  });
  it("masks the other party: valid numbers, short codes as they are, hidden numbers in words", () => {
    expect(maskCounterpart("91", "9820123456")).toBe("+91 98••• ••456");
    expect(maskCounterpart("1", "4155550123")).toBe("+14 ••• ••123");
    expect(maskCounterpart("91", "1503")).toBe("1503");
    expect(maskCounterpart("91", "")).toBe("Hidden number");
    expect(maskCounterpart("91", "Private")).toBe("Hidden number");
    expect(maskCounterpart(null, null)).toBe("Hidden number");
  });
  it("masks longer invalid digits, hiding at least half of them", () => {
    const masked = maskCounterpart("91", "18001234567");
    expect(masked).toBe("18••• ••67");
    expect(masked).not.toMatch(/\d{3}/);
  });
});

describe("redactPhones", () => {
  it("masks numbers in a sentence, with or without the +", () => {
    expect(redactPhones("Called +919820123456 then 9820123456.")).toBe("Called +91 98••• ••456 then +91 98••• ••456.");
  });
  it("leaves ids, dates and short numbers alone", () => {
    const uuid = "3f1c2b9e-7d4a-4c1b-9a8e-446655440000";
    const text = `Meeting ${uuid} on 2026-11-19, extension 1234567`;
    expect(redactPhones(text)).toBe(text);
  });
  it("does not take a digit run inside a word or a hex id for a number", () => {
    expect(redactPhones("ref ab9820123456 and 9820123456cd")).toBe("ref ab9820123456 and 9820123456cd");
  });
});

describe("nameWithoutNumber", () => {
  it("takes numbers out of a name and keeps the rest", () => {
    expect(nameWithoutNumber("keyur 9820000002")).toBe("keyur");
    expect(nameWithoutNumber("Ravi +91 (98201) 234-56 Cafe 89")).toBe("Ravi Cafe 89");
    expect(nameWithoutNumber("Line 2")).toBe("Line 2");
  });
  it("is null when no letter is left", () => {
    expect(nameWithoutNumber("+91 98111 00010")).toBeNull();
    expect(nameWithoutNumber("1503")).toBeNull();
    expect(nameWithoutNumber("")).toBeNull();
    expect(nameWithoutNumber(undefined)).toBeNull();
  });
});

describe("normalizeDigitQuery", () => {
  it("needs at least 7 digits", () => {
    expect(normalizeDigitQuery("98201")).toBeNull();
    expect(normalizeDigitQuery("abc")).toBeNull();
    expect(normalizeDigitQuery("9820123")).toBe("9820123");
  });
  it("drops a leading 0 or 91 in front of a 10-digit number", () => {
    expect(normalizeDigitQuery("+91 98201 23456")).toBe("9820123456");
    expect(normalizeDigitQuery("09820123456")).toBe("9820123456");
    expect(normalizeDigitQuery("919820123456")).toBe("9820123456");
    expect(normalizeDigitQuery("98201 23456")).toBe("9820123456");
  });
});
