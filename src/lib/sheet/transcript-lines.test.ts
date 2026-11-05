import { describe, expect, it } from "vitest";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import { buildTranscriptLines, isGenericLabel, mapSpeaker, type LineParticipant, type RosterPerson } from "./transcript-lines";

const participants: LineParticipant[] = [
  { name: "Priya Nair", email: "priya@dnyhospitality.com", side: "dny" },
  { name: "Rakesh Agarwal", email: "rakesh@saffroncourt.in", side: "client" },
  { name: null, email: "someone@gmail.com", side: "unknown" },
];
const roster: RosterPerson[] = [
  { full_name: "Priya Nair", email: "priya@dnyhospitality.com", dept: "accounts" },
  { full_name: "Arjun Mehta", email: "arjun@dnyhospitality.com", dept: "operations" },
];

const turns: SpeakerTurn[] = [
  { speaker: "Priya Nair", startSec: 12.4, endSec: 20, text: "Good morning everyone." },
  { speaker: "Rakesh ji", startSec: 61, endSec: 70, text: "Haan Priya, awaaz aa rahi hai." },
  { speaker: "Arjun", startSec: 3725, endSec: 3730, text: "Occupancy closed at 72 percent." },
  { speaker: "Speaker 2", startSec: 3800, endSec: 3805, text: "Okay." },
];

describe("mapSpeaker", () => {
  it("maps participants first, then the DNY roster, and never generic labels", () => {
    expect(mapSpeaker("Priya Nair", participants, roster)).toMatchObject({ side: "dny", name: "Priya Nair", role: "accounts" });
    expect(mapSpeaker("Rakesh ji", participants, roster)).toMatchObject({ side: "client", name: "Rakesh Agarwal", role: null });
    expect(mapSpeaker("Arjun", participants, roster)).toMatchObject({ side: "dny", name: "Arjun Mehta", role: "operations" });
    expect(mapSpeaker("Speaker 2", participants, roster)).toMatchObject({ side: "unknown", name: null });
    expect(isGenericLabel("Unknown speaker")).toBe(true);
    expect(isGenericLabel("Sunita Rao")).toBe(false);
  });
});

describe("buildTranscriptLines", () => {
  const result = buildTranscriptLines(turns, participants, roster);

  it("formats markers, keeps raw labels and appends side tags", () => {
    expect(result.lines[0]).toBe("[0:12] Priya Nair (DNY): Good morning everyone.");
    expect(result.lines[1]).toBe("[1:01] Rakesh ji (Client): Haan Priya, awaaz aa rahi hai.");
    expect(result.lines[2]).toBe("[1:02:05] Arjun (DNY): Occupancy closed at 72 percent.");
    expect(result.lines[3]).toBe("[1:03:20] Speaker 2: Okay.");
  });

  it("reports reliable labels when at least half mapped", () => {
    expect(result.speakerLabelsReliable).toBe(true);
    const generic = buildTranscriptLines(
      [
        { speaker: "Speaker 1", startSec: 0, endSec: 1, text: "Hello" },
        { speaker: "Speaker 2", startSec: 2, endSec: 3, text: "Hi" },
        { speaker: "Priya Nair", startSec: 4, endSec: 5, text: "Yes" },
      ],
      participants,
      roster,
    );
    expect(generic.speakerLabelsReliable).toBe(false);
    expect(buildTranscriptLines([], participants, roster).speakerLabelsReliable).toBe(false);
  });

  it("gives a language hint", () => {
    expect(result.language.hint).toBe("hinglish");
    expect(result.speakers).toHaveLength(4);
  });
});
