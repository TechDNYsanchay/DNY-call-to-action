import { describe, expect, it } from "vitest";
import { evidenceAriaLabel, recordingUrl, spokenTime } from "./evidence";

describe("recordingUrl", () => {
  it("appends the timestamp only when the parameter name is known", () => {
    expect(recordingUrl("https://app.tldv.io/meetings/abc", 754, undefined)).toBe("https://app.tldv.io/meetings/abc");
    expect(recordingUrl("https://app.tldv.io/meetings/abc", 754.9, "t")).toBe("https://app.tldv.io/meetings/abc?t=754");
    expect(recordingUrl("https://app.tldv.io/meetings/abc?x=1", 10, "t")).toBe("https://app.tldv.io/meetings/abc?x=1&t=10");
    expect(recordingUrl(null, 10, "t")).toBeNull();
    expect(recordingUrl("not a url", 10, "t")).toBe("not a url");
  });

  it("speaks the time for screen readers", () => {
    expect(spokenTime(754)).toBe("12 minutes 34 seconds");
    expect(spokenTime(3661)).toBe("1 hour 1 minute 1 second");
    expect(evidenceAriaLabel(754, "Rahul")).toBe("Open recording at 12 minutes 34 seconds, quote from Rahul");
    expect(evidenceAriaLabel(null, null)).toBe("Open recording");
  });
});
