import { describe, expect, it } from "vitest";
import type { TldvMeeting } from "@/lib/tldv/parse";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import {
  canChangeType,
  countSentences,
  endedAt,
  metadataColumns,
  nameMatches,
  participantRows,
  planAfterTranscript,
  planAfterUpsert,
  speakerLabelsReliable,
  statusAfterWaiting,
  transcriptDecision,
  type MeetingState,
} from "./decisions";
import type { RulesResult } from "./rules";

const meeting: TldvMeeting = {
  id: "m1",
  title: "Weekly review",
  happenedAt: "2026-11-03T05:00:00.000Z",
  durationSec: 2712,
  organizer: { name: "Priya Nair", email: "Priya@dnyhospitality.com" },
  invitees: [
    { name: "Priya Nair", email: "priya@dnyhospitality.com" },
    { name: "Rakesh Agarwal", email: "rakesh@hotelsunrise.in" },
    { name: "Phone guest", email: null },
  ],
  url: null,
};

const state = (over: Partial<MeetingState> = {}): MeetingState => ({ type: "unknown", type_source: "rule", process_status: "new", transcript_ready: false, ...over });

const clientRule: RulesResult = { type: "client", source: "rule", confidence: 0.95, reason: "hotelsunrise.in is Hotel Sunrise's domain (1 person on the invite).", decided: true, rule: "B", clientId: "c1" };
const shortRule: RulesResult = { type: "other", source: "rule", confidence: 0.95, reason: "Recording is only 2 min long; too short to be a real meeting.", decided: true, rule: "A", clientId: null };
const unknownRule: RulesResult = { type: "unknown", source: "rule", confidence: 0.5, reason: "1 person from gmail.com, none on the client list.", decided: false, rule: null, clientId: null };

describe("metadata and participants", () => {
  it("maps a tl;dv meeting to the meetings columns, with a fallback link", () => {
    expect(metadataColumns(meeting)).toEqual({
      tldv_meeting_id: "m1",
      title: "Weekly review",
      happened_at: "2026-11-03T05:00:00.000Z",
      duration_sec: 2712,
      organizer_email: "Priya@dnyhospitality.com",
      organizer_name: "Priya Nair",
      tldv_url: "https://app.tldv.io/meetings/m1",
    });
  });
  it("builds one participant row per email, marking DNY and the organiser, dropping people without email", () => {
    expect(participantRows(meeting)).toEqual([
      { email: "priya@dnyhospitality.com", name: "Priya Nair", is_dny: true, is_organizer: true },
      { email: "rakesh@hotelsunrise.in", name: "Rakesh Agarwal", is_dny: false, is_organizer: false },
    ]);
  });
});

describe("who may change the type", () => {
  it("locks human labels and meetings the routine owns", () => {
    expect(canChangeType(state())).toBe(true);
    expect(canChangeType(state({ process_status: "ready" }))).toBe(true);
    expect(canChangeType(state({ type_source: "human" }))).toBe(false);
    for (const s of ["processing", "done", "needs_decision", "failed"] as const) expect(canChangeType(state({ process_status: s }))).toBe(false);
  });
});

describe("planAfterUpsert", () => {
  it("a new meeting starts 'new' with the rule's type", () => {
    expect(planAfterUpsert(null, clientRule)).toEqual({ typeColumns: { type: "client", type_source: "rule", type_confidence: 0.95, type_reason: clientRule.reason, client_id: "c1" }, process_status: "new" });
    expect(planAfterUpsert(null, unknownRule).process_status).toBe("new");
  });
  it("a new too-short recording is skipped straight away", () => {
    expect(planAfterUpsert(null, shortRule).process_status).toBe("skipped");
  });
  it("an existing meeting gets its type refreshed but keeps its status", () => {
    expect(planAfterUpsert(state({ process_status: "ready" }), clientRule)).toEqual({ typeColumns: expect.objectContaining({ type: "client" }), process_status: null });
  });
  it("an existing meeting still waiting is skipped when the duration says too short", () => {
    expect(planAfterUpsert(state({ process_status: "waiting_transcript" }), shortRule).process_status).toBe("skipped");
    expect(planAfterUpsert(state({ process_status: "ready" }), shortRule).process_status).toBeNull();
  });
  it("never touches a human label or a meeting the routine owns", () => {
    expect(planAfterUpsert(state({ type_source: "human", type: "sales" }), clientRule)).toEqual({ typeColumns: null, process_status: null });
    expect(planAfterUpsert(state({ process_status: "done" }), shortRule)).toEqual({ typeColumns: null, process_status: null });
  });
});

describe("planAfterTranscript", () => {
  it("undecided -> ready for the routine", () => {
    expect(planAfterTranscript(state({ process_status: "waiting_transcript" }), unknownRule)).toEqual({ typeColumns: expect.objectContaining({ type: "unknown", type_confidence: 0.5 }), process_status: "ready" });
  });
  it("decided client -> ready with the client id", () => {
    const plan = planAfterTranscript(state(), clientRule);
    expect(plan.process_status).toBe("ready");
    expect(plan.typeColumns?.client_id).toBe("c1");
  });
  it("decided non-client -> skipped", () => {
    expect(planAfterTranscript(state(), shortRule).process_status).toBe("skipped");
  });
  it("a late transcript re-opens a meeting skipped for having none", () => {
    expect(planAfterTranscript(state({ process_status: "skipped" }), unknownRule).process_status).toBe("ready");
  });
  it("a human label keeps its type; status follows the label", () => {
    expect(planAfterTranscript(state({ type_source: "human", type: "client" }), shortRule)).toEqual({ typeColumns: null, process_status: "ready" });
    expect(planAfterTranscript(state({ type_source: "human", type: "sales" }), clientRule)).toEqual({ typeColumns: null, process_status: "skipped" });
  });
  it("a meeting the routine owns is left alone", () => {
    for (const s of ["processing", "done", "needs_decision", "failed"] as const) {
      expect(planAfterTranscript(state({ process_status: s }), clientRule)).toEqual({ typeColumns: null, process_status: null });
    }
  });
});

describe("statusAfterWaiting", () => {
  it("only 'new' moves to waiting_transcript", () => {
    expect(statusAfterWaiting(state())).toBe("waiting_transcript");
    expect(statusAfterWaiting(state({ process_status: "waiting_transcript" }))).toBeNull();
    expect(statusAfterWaiting(state({ process_status: "ready" }))).toBeNull();
  });
});

describe("transcriptDecision", () => {
  const started = "2026-11-03T05:00:00.000Z";
  const m = (over: Partial<Parameters<typeof transcriptDecision>[0]> = {}) => ({ happened_at: started, duration_sec: 3600, transcript_ready: false, process_status: "waiting_transcript" as const, ...over });
  it("computes the end of the recording", () => {
    expect(endedAt(m()).toISOString()).toBe("2026-11-03T06:00:00.000Z");
  });
  it("waits for 10 minutes after the recording ends", () => {
    expect(transcriptDecision(m(), new Date("2026-11-03T06:05:00Z"))).toBe("wait");
    expect(transcriptDecision(m(), new Date("2026-11-03T06:11:00Z"))).toBe("try");
  });
  it("gives up 48 hours after the recording ends", () => {
    expect(transcriptDecision(m(), new Date("2026-11-05T05:59:00Z"))).toBe("try");
    expect(transcriptDecision(m(), new Date("2026-11-05T06:01:00Z"))).toBe("give_up");
  });
  it("ignores meetings that have a transcript or are not waiting for one", () => {
    expect(transcriptDecision(m({ transcript_ready: true }), new Date("2026-11-03T07:00:00Z"))).toBe("none");
    expect(transcriptDecision(m({ process_status: "skipped" }), new Date("2026-11-03T07:00:00Z"))).toBe("none");
    expect(transcriptDecision(m({ process_status: "new" }), new Date("2026-11-03T07:00:00Z"))).toBe("try");
  });
});

describe("transcript measures", () => {
  const turns: SpeakerTurn[] = [
    { speaker: "Priya Nair", startSec: 0, endSec: 5, text: "Good morning everyone. Rakesh ji, aap sun paa rahe hain?" },
    { speaker: "Rakesh", startSec: 6, endSec: 9, text: "Haan Priya, sun raha hoon।" },
    { speaker: "Speaker 3", startSec: 10, endSec: 12, text: "ok" },
  ];
  it("counts sentences by terminal punctuation, at least one per turn", () => {
    expect(countSentences(turns)).toBe(4);
  });
  it("matches speaker labels to names loosely", () => {
    expect(nameMatches("Priya", "Priya Nair")).toBe(true);
    expect(nameMatches("priya nair", "Priya Nair")).toBe(true);
    expect(nameMatches("Rakesh Agarwal (Hotel Sunrise)", "Rakesh Agarwal")).toBe(true);
    expect(nameMatches("Rakesh Agrawal", "Rakesh Agarwal")).toBe(true);
    expect(nameMatches("Suneeta Agarwal", "Sunita Agarwal")).toBe(true);
    expect(nameMatches("Arjun Mehta", "Arjun Mehra")).toBe(true);
    expect(nameMatches("Raj", "Ram Kumar")).toBe(false);
    expect(nameMatches("Speaker 1", "Priya Nair")).toBe(false);
    expect(nameMatches("A", "Arjun Mehta")).toBe(false);
    expect(nameMatches("", "Arjun Mehta")).toBe(false);
  });
  it("is reliable when at least half of the labels map to a participant", () => {
    const names = ["Priya Nair", "Rakesh Agarwal", null];
    expect(speakerLabelsReliable(turns.map((t) => t.speaker), names)).toBe(true);
    expect(speakerLabelsReliable(["Speaker 1", "Speaker 2", "Priya Nair"], names)).toBe(false);
    expect(speakerLabelsReliable(["Speaker 1", "Priya Nair"], names)).toBe(true);
    expect(speakerLabelsReliable(["Priya Nair"], [])).toBe(false);
    expect(speakerLabelsReliable([], names)).toBeNull();
  });
});
