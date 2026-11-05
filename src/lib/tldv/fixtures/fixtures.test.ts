import { describe, expect, it } from "vitest";
import { externalsOf, parseTldvMeeting, parseTldvTranscript, parseTldvWebhook } from "../parse";
import { wordCount } from "../turns";
import meeting from "./meeting.json";
import transcript from "./transcript.json";
import meetingReady from "./webhook-meeting-ready.json";
import transcriptReady from "./webhook-transcript-ready.json";

describe("fixtures parse like the real tl;dv shapes", () => {
  it("meeting.json -> TldvMeeting", () => {
    const m = parseTldvMeeting(meeting);
    expect(m).toMatchObject({
      id: "6911a3f0c2d4e8b1a7f93c21",
      title: "Hotel Sunrise Udaipur - weekly ops review",
      happenedAt: "2026-11-03T05:00:00.000Z",
      durationSec: 2712,
      url: "https://app.tldv.io/meetings/6911a3f0c2d4e8b1a7f93c21",
    });
    expect(m?.organizer.email).toBe("priya@dnyhospitality.com");
    expect(m?.invitees).toHaveLength(4);
    expect(externalsOf(m!).map((p) => p.email)).toEqual(["rakesh@hotelsunrise.in", "sunita.agarwal@gmail.com"]);
  });

  it("transcript.json has about 40 sentences, four speakers and Hinglish", () => {
    expect(transcript.meetingId).toBe(meeting.id);
    expect(transcript.data.length).toBeGreaterThanOrEqual(40);
    expect(new Set(transcript.data.map((s) => s.speaker)).size).toBe(4);
    expect(transcript.data.some((s) => /hoon|tak|theek/i.test(s.text))).toBe(true);
    for (let i = 1; i < transcript.data.length; i++) expect(transcript.data[i].startTime).toBeGreaterThan(transcript.data[i - 1].startTime);
    const turns = parseTldvTranscript(transcript)!;
    expect(turns.length).toBeGreaterThan(10);
    expect(wordCount(turns)).toBeGreaterThan(300);
    expect(turns.every((t) => t.endSec >= t.startSec)).toBe(true);
  });

  it("webhook-meeting-ready.json -> MeetingReady with metadata and no transcript", () => {
    const hook = parseTldvWebhook(meetingReady);
    expect(hook).toMatchObject({ id: "evt_01JBX5M9K2Q7W3R8T6Y4V0N1P2", event: "MeetingReady", meetingId: meeting.id, executedAt: "2026-11-03T06:12:41.000Z" });
    expect(hook?.meeting?.invitees).toHaveLength(4);
    expect(hook?.transcript).toBeNull();
  });

  it("webhook-transcript-ready.json -> TranscriptReady with the transcript and no metadata", () => {
    const hook = parseTldvWebhook(transcriptReady);
    expect(hook).toMatchObject({ id: "evt_01JBX5N4D8H2K6M1P9R3T7V5X0", event: "TranscriptReady", meetingId: meeting.id });
    expect(hook?.meeting).toBeNull();
    expect(hook?.transcript?.length).toBeGreaterThan(10);
  });
});
