import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("falls back to defaults when rows are missing", () => {
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
  });
  it("reads JSON values, including numbers saved as strings", () => {
    const s = parseSettings([
      { key: "pipeline_paused", value: true },
      { key: "max_per_run", value: "7" },
      { key: "confidence_threshold", value: 0.9 },
      { key: "claim_timeout_minutes", value: 45 },
      { key: "max_attempts", value: "2" },
      { key: "retention_months", value: 6 },
    ]);
    expect(s).toEqual({ pipeline_paused: true, max_per_run: 7, confidence_threshold: 0.9, claim_timeout_minutes: 45, max_attempts: 2, retention_months: 6 });
  });
  it("ignores values that make no sense", () => {
    const s = parseSettings([
      { key: "max_attempts", value: "many" },
      { key: "retention_months", value: -1 },
      { key: "pipeline_paused", value: "yes" },
    ]);
    expect(s.max_attempts).toBe(3);
    expect(s.retention_months).toBe(12);
    expect(s.pipeline_paused).toBe(false);
  });
});
