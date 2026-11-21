import { describe, expect, it } from "vitest";
import { CALL_SKIP_TYPES, callSkipCode, RELEASE_TEXT, releaseCodeOf, type SkipCode, skipReason } from "./skip";

const CODES: SkipCode[] = ["no_speech", "personal", "internal", "sales", "wrong_number", "no_content", "not_business", "undecided", "line_off"];

describe("callSkipCode", () => {
  it("maps each non-work type to its code, 'other' to not_business", () => {
    expect(CALL_SKIP_TYPES.map(callSkipCode)).toEqual(["personal", "internal", "sales", "wrong_number", "no_content", "not_business"]);
    expect(callSkipCode("other")).toBe("not_business");
  });
  it("gives no code for business types or anything unknown", () => {
    for (const type of ["client", "vendor", "unknown", "", "no_speech", "Personal"]) expect(callSkipCode(type)).toBeNull();
  });
});

describe("skipReason", () => {
  it("is fixed text with no digits that says what was deleted", () => {
    for (const code of CODES) {
      for (const reason of [skipReason(code), skipReason(code, "Ashwini Bhambani")]) {
        expect(reason).not.toMatch(/\d/);
        expect(reason).toContain("deleted");
      }
    }
  });
  it("names the person who marked a call not a work call", () => {
    expect(skipReason("not_business", "Ashwini Bhambani")).toBe("Marked not a work call by Ashwini Bhambani. The recording, transcript and sheet were deleted.");
    expect(skipReason("not_business")).toBe("Not a work call. The recording and transcript were deleted.");
    expect(skipReason("personal", "Ashwini")).toBe("Personal call. The recording and transcript were deleted.");
  });
});

describe("release codes", () => {
  it("has a text for every code", () => {
    for (const code of ["sheet_checks", "empty_transcript", "server_error", "other"] as const) expect(RELEASE_TEXT[code].length).toBeGreaterThan(10);
  });
  it("reads a missing or unknown code as other", () => {
    expect(releaseCodeOf("sheet_checks")).toBe("sheet_checks");
    expect(releaseCodeOf(null)).toBe("other");
    expect(releaseCodeOf("toString")).toBe("other");
    expect(releaseCodeOf("give up")).toBe("other");
  });
});
