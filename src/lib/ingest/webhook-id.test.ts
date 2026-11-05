import { describe, expect, it } from "vitest";
import { retentionCutoff } from "./retention";
import { isStaleWebhook, webhookEventId } from "./webhook-id";

describe("webhookEventId", () => {
  it("uses tl;dv's payload id when present", () => {
    expect(webhookEventId({ id: "evt_1", event: "MeetingReady", meetingId: "m1", executedAt: null })).toBe("evt_1");
  });
  it("hashes event, meeting and time otherwise, deterministically", () => {
    const a = webhookEventId({ id: null, event: "TranscriptReady", meetingId: "m1", executedAt: "2026-11-03T06:00:00Z" });
    const b = webhookEventId({ id: null, event: "TranscriptReady", meetingId: "m1", executedAt: "2026-11-03T06:00:00Z" });
    const c = webhookEventId({ id: null, event: "MeetingReady", meetingId: "m1", executedAt: "2026-11-03T06:00:00Z" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^h_[0-9a-f]{40}$/);
  });
});

describe("isStaleWebhook", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  it("ignores events older than 24 hours, keeps recent and undated ones", () => {
    expect(isStaleWebhook("2026-11-03T11:59:00Z", now)).toBe(true);
    expect(isStaleWebhook("2026-11-03T12:01:00Z", now)).toBe(false);
    expect(isStaleWebhook(null, now)).toBe(false);
    expect(isStaleWebhook("not a date", now)).toBe(false);
  });
});

describe("retentionCutoff", () => {
  it("goes back whole months", () => {
    expect(retentionCutoff(12, new Date("2026-11-04T12:00:00Z")).toISOString()).toBe("2025-11-04T12:00:00.000Z");
    expect(retentionCutoff(0, new Date("2026-11-04T12:00:00Z")).toISOString()).toBe("2026-10-04T12:00:00.000Z");
  });
});
