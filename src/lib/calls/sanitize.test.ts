import { describe, expect, it } from "vitest";
import { LOG_TEXT_MAX, pgErrorText, sanitizeForLog } from "./sanitize";

describe("sanitizeForLog", () => {
  it("replaces links, including recording links and signed URLs", () => {
    const text = sanitizeForLog("Download of https://media1.callyzer.co/rec/abc.mp3 failed; signed http://127.0.0.1:54321/storage/v1/object/sign/x?token=eyJ done");
    expect(text).toBe("Download of [link] failed; signed [link] done");
    expect(text).not.toContain("token=");
    expect(text).not.toContain("media1.callyzer.co");
  });
  it("masks phone numbers", () => {
    expect(sanitizeForLog("Call from +919820123456 on line 9820000001")).toBe("Call from +91 98••• ••456 on line +91 98••• ••001");
  });
  it("cuts the text to 300 characters", () => {
    expect(sanitizeForLog("x".repeat(1000))).toHaveLength(LOG_TEXT_MAX);
  });
  it("never leaves 10 digits in a row", () => {
    expect(sanitizeForLog("ids 98201234567 and 919820123456 and 4155550123")).not.toMatch(/\d{10}/);
  });
});

describe("pgErrorText", () => {
  it("keeps the code and the message only", () => {
    const error = { code: "23505", message: "duplicate key value violates unique constraint \"call_log_pkey\"", details: "Key (callyzer_id)=(abc) already exists.", hint: "Check the row" };
    const text = pgErrorText(error);
    expect(text).toBe("23505 duplicate key value violates unique constraint \"call_log_pkey\"");
    expect(text).not.toContain("Key (");
    expect(text).not.toContain("hint");
  });
  it("works without a code and sanitises the message", () => {
    expect(pgErrorText({ message: "fetch failed for https://x.supabase.co/rest/v1/rpc" })).toBe("fetch failed for [link]");
  });
});
