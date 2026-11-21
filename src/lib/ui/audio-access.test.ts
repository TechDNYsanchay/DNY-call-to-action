import { describe, expect, it } from "vitest";
import { audioExtension, audioFormatName, decideAudioAccess, downloadFileName, recordingAvailability } from "./audio-access";

const base = { purgedAt: null, recordingStatus: "stored", path: "calls/2026/11/abc-12345678", type: "unknown" as const, isAdmin: false, isLineMember: false };

describe("decideAudioAccess", () => {
  it("refuses a purged call before anything else", () => {
    expect(decideAudioAccess({ ...base, purgedAt: "2026-11-19T10:00:00Z", isAdmin: true })).toEqual({ ok: false, status: 409, reason: "not_work" });
  });

  it("refuses audio that is no longer stored", () => {
    expect(decideAudioAccess({ ...base, type: "client", recordingStatus: "deleted" })).toEqual({ ok: false, status: 409, reason: "deleted" });
    expect(decideAudioAccess({ ...base, type: "client", path: null, isAdmin: true })).toEqual({ ok: false, status: 409, reason: "deleted" });
  });

  it("keeps an undecided call to admins and the line's people", () => {
    expect(decideAudioAccess(base)).toEqual({ ok: false, status: 403, reason: "not_classified" });
    expect(decideAudioAccess({ ...base, isLineMember: true })).toEqual({ ok: true });
    expect(decideAudioAccess({ ...base, isAdmin: true })).toEqual({ ok: true });
    expect(decideAudioAccess({ ...base, type: "other" })).toEqual({ ok: false, status: 403, reason: "not_classified" });
  });

  it("opens a business call to every active person", () => {
    expect(decideAudioAccess({ ...base, type: "client" })).toEqual({ ok: true });
    expect(decideAudioAccess({ ...base, type: "vendor" })).toEqual({ ok: true });
  });
});

describe("recordingAvailability", () => {
  const input = { purgedAt: null, recordingStatus: "stored", path: "p", type: "client" as const, playable: true, canSeeUndecided: false };
  it("says why the player cannot play", () => {
    expect(recordingAvailability(input)).toBe("stored");
    expect(recordingAvailability({ ...input, purgedAt: "2026-11-19T10:00:00Z" })).toBe("not_work");
    expect(recordingAvailability({ ...input, recordingStatus: "deleted", path: null })).toBe("deleted");
    expect(recordingAvailability({ ...input, type: "unknown" })).toBe("withheld");
    expect(recordingAvailability({ ...input, type: "unknown", canSeeUndecided: true })).toBe("stored");
    expect(recordingAvailability({ ...input, playable: false })).toBe("unplayable");
  });
});

describe("download names", () => {
  it("uses the IST time and the format's extension", () => {
    expect(downloadFileName("2026-11-18T06:10:00Z", "audio/mpeg")).toBe("call-2026-11-18-1140.mp3");
    expect(downloadFileName("2026-11-18T18:40:00Z", "audio/amr")).toBe("call-2026-11-19-0010.amr");
    expect(audioExtension(null)).toBe("audio");
    expect(audioFormatName("audio/mp4")).toBe("M4A");
  });
});
