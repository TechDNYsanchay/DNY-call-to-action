import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/supabase/database.types";
import { DEFAULT_CALLS_SETTINGS, parseCallsSettings } from "./settings";

const rows = (values: Record<string, Json>) => Object.entries(values).map(([key, value]) => ({ key, value }));

describe("parseCallsSettings", () => {
  it("is paused, with the defaults, when nothing is set", () => {
    const s = parseCallsSettings([]);
    expect(s).toEqual(DEFAULT_CALLS_SETTINGS);
    expect(s.paused).toBe(true);
    expect(s.mipOptOut).toBe(true);
  });

  it("reads the values the migration writes", () => {
    const s = parseCallsSettings(
      rows({
        calls_paused: false,
        calls_min_duration_sec: 45,
        calls_max_minutes: 90,
        calls_initial_lines: ["Ashwini Bhambani", "keyur dny supply chain"],
        calls_dny_numbers: [],
        calls_max_audio_minutes_per_day: 240,
        calls_claim_timeout_minutes: 20,
        calls_night_poll_minutes: 2,
        pipeline_paused: false,
        max_attempts: 3,
      }),
    );
    expect(s).toMatchObject({ paused: false, minDurationSec: 45, maxMinutes: 90, initialLines: ["Ashwini Bhambani", "keyur dny supply chain"], dnyNumbers: [], maxAudioMinutesPerDay: 240 });
  });

  it("reads numbers saved as strings and booleans saved as strings", () => {
    const s = parseCallsSettings(rows({ calls_min_duration_sec: "45", calls_paused: "false", calls_deepgram_mip_opt_out: "false" }));
    expect(s.minDurationSec).toBe(45);
    expect(s.paused).toBe(false);
    expect(s.mipOptOut).toBe(false);
  });

  it("pulls numbers into their bounds", () => {
    const low = parseCallsSettings(rows({ calls_min_duration_sec: 5, calls_max_minutes: 1, calls_max_audio_minutes_per_day: 0, calls_claim_timeout_minutes: 1, calls_decision_hours: 1 }));
    expect(low).toMatchObject({ minDurationSec: 15, maxMinutes: 30, maxAudioMinutesPerDay: 10, claimTimeoutMinutes: 10, decisionHours: 4 });
    const high = parseCallsSettings(rows({ calls_min_duration_sec: 9000, calls_max_minutes: 999, calls_max_audio_minutes_per_day: 99999, calls_claim_timeout_minutes: 600, calls_decision_hours: 1000 }));
    expect(high).toMatchObject({ minDurationSec: 600, maxMinutes: 240, maxAudioMinutesPerDay: 2000, claimTimeoutMinutes: 60, decisionHours: 168 });
  });

  it("falls back to the default for values that are not numbers", () => {
    expect(parseCallsSettings(rows({ calls_min_duration_sec: "soon", calls_max_minutes: null, calls_decision_hours: [] }))).toMatchObject({ minDurationSec: 45, maxMinutes: 90, decisionHours: 24 });
  });

  it("only takes the night cadences on offer", () => {
    expect(parseCallsSettings(rows({ calls_night_poll_minutes: 10 })).nightPollMinutes).toBe(10);
    expect(parseCallsSettings(rows({ calls_night_poll_minutes: "30" })).nightPollMinutes).toBe(30);
    expect(parseCallsSettings(rows({ calls_night_poll_minutes: 7 })).nightPollMinutes).toBe(2);
    expect(parseCallsSettings(rows({ calls_night_poll_minutes: "x" })).nightPollMinutes).toBe(2);
  });

  it("reads bad arrays as empty and keeps only valid DNY numbers, as E.164", () => {
    expect(parseCallsSettings(rows({ calls_initial_lines: "Ashwini", calls_dny_numbers: { a: 1 } }))).toMatchObject({ initialLines: [], dnyNumbers: [] });
    expect(parseCallsSettings(rows({ calls_initial_lines: ["  support ", 3, ""], calls_dny_numbers: ["98201 23456", "+919820000003", "1503", 7] }))).toMatchObject({
      initialLines: ["support"],
      dnyNumbers: ["+919820123456", "+919820000003"],
    });
  });
});
