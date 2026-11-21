import { describe, expect, it } from "vitest";
import { quietSectionsLine, refinedSeconds, sheetParticipants, speakerNamesOf, speakerSidesOf } from "./call-sheet";

const result = {
  headline: "Costing goes to the owner by Friday",
  participants: [
    { speaker_label: "Speaker 1", name: "Ashwini Bhambani", side: "dny", role_guess: null, confidence: 0.9 },
    { speaker_label: "Speaker 2", name: null, side: "client", role_guess: null, confidence: 0.7 },
    { speaker_label: "Speaker 3", name: "Hold music", side: "weird", role_guess: null, confidence: 0.2 },
    { name: "no label" },
  ],
  verification: { evidence_seconds: { A1: [12.5, 40], D1: [], F1: ["x", 3], bad: "no" } },
};

describe("call sheet extras", () => {
  it("reads participants and refined seconds defensively", () => {
    expect(sheetParticipants(result)).toEqual([
      { speaker_label: "Speaker 1", name: "Ashwini Bhambani", side: "dny" },
      { speaker_label: "Speaker 2", name: null, side: "client" },
      { speaker_label: "Speaker 3", name: "Hold music", side: "unknown" },
    ]);
    expect(refinedSeconds(result)).toEqual({ A1: [12.5, 40], F1: [3] });
    expect(sheetParticipants(null)).toEqual([]);
    expect(refinedSeconds({ verification: null })).toEqual({});
  });

  it("names speakers by side, the other side as client or vendor", () => {
    const participants = sheetParticipants(result);
    expect(speakerNamesOf(participants, { word: "vendor" })).toEqual({ "Speaker 1": "Ashwini Bhambani (DNY)", "Speaker 2": "Speaker 2 (vendor)", "Speaker 3": "Hold music" });
    expect(speakerNamesOf(participants, { word: "client" })["Speaker 2"]).toBe("Speaker 2 (client)");
    expect(speakerSidesOf(participants)).toEqual({ "Speaker 1": "dny", "Speaker 2": "other" });
  });

  it("folds empty sections into one line", () => {
    expect(quietSectionsLine(["decisions", "risks", "open questions"])).toBe("No decisions, risks or open questions on this call.");
    expect(quietSectionsLine(["follow-up"])).toBe("No follow-up on this call.");
    expect(quietSectionsLine([])).toBeNull();
  });
});
