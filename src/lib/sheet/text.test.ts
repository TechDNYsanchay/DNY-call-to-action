import { describe, expect, it } from "vitest";
import { bestMatch, detectLanguage, hasNumber, normaliseText, tokenOverlap, tokenSetRatio } from "./text";

describe("normaliseText", () => {
  it("lowercases, strips punctuation and collapses spaces, keeping Devanagari", () => {
    expect(normaliseText("  Hello,   World! ")).toBe("hello world");
    expect(normaliseText("ढाई लाख, theek hai?")).toBe("ढाई लाख theek hai");
    expect(normaliseText("F&B cost: 38%")).toBe("f b cost 38");
  });
});

describe("tokenSetRatio", () => {
  it("scores shared-token names high and unrelated labels low", () => {
    expect(tokenSetRatio("Rakesh ji", "Rakesh Sharma")).toBeGreaterThanOrEqual(0.8);
    expect(tokenSetRatio("priya nair", "Priya Nair")).toBe(1);
    expect(tokenSetRatio("Speaker 2", "Priya Nair")).toBeLessThan(0.8);
    // Transliteration variants still match through the character ratio.
    expect(tokenSetRatio("Suneeta Rao", "Sunita Rao")).toBeGreaterThanOrEqual(0.8);
    expect(tokenSetRatio("Arjun", "Arjun Mehta")).toBeGreaterThanOrEqual(0.8);
  });
  it("is 0 for empty input", () => {
    expect(tokenSetRatio("", "x")).toBe(0);
  });
});

describe("tokenOverlap", () => {
  it("is the share of needle tokens present in the haystack", () => {
    expect(tokenOverlap("send the roster by friday", "we will send the duty roster by friday evening")).toBe(1);
    expect(tokenOverlap("a b c d e", "a b x y z")).toBeCloseTo(0.4);
    expect(tokenOverlap("", "anything")).toBe(0);
  });
});

describe("bestMatch", () => {
  it("returns the best candidate above the threshold, or null", () => {
    const people = [{ name: "Priya Nair" }, { name: "Arjun Mehta" }, { name: null }];
    expect(bestMatch("Arjun", people, (p) => p.name)?.name).toBe("Arjun Mehta");
    expect(bestMatch("Speaker 1", people, (p) => p.name)).toBeNull();
  });
});

describe("hasNumber", () => {
  it("accepts digits in both scripts and number words in English, Hinglish and Hindi", () => {
    expect(hasNumber("about 3,024")).toBe(true);
    expect(hasNumber("५ लाख")).toBe(true);
    expect(hasNumber("saade paanch lakh per month")).toBe(true);
    expect(hasNumber("ढाई लाख ka kharcha")).toBe(true);
    expect(hasNumber("twenty rooms")).toBe(true);
    expect(hasNumber("the payroll went up a lot")).toBe(false);
  });
});

describe("detectLanguage", () => {
  it("tells English, Hinglish and Hindi apart", () => {
    expect(detectLanguage("We will send the revised roster by Friday and review the vendor rates next week.").hint).toBe("english");
    expect(detectLanguage("Haan theek hai, kal tak bhej do, nahi toh problem hoga. Roster bhi chahiye.").hint).toBe("hinglish");
    expect(detectLanguage("हम कल रिपोर्ट भेज देंगे और रोस्टर भी साथ में होगा।").hint).toBe("hindi");
  });
});
