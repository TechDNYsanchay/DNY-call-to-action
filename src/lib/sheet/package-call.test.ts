import { describe, expect, it } from "vitest";
import type { CallContext } from "./load";
import { CALL_SPEAKERS_NOTE, callBlockOf, callClassificationDecided, languageNoteFor, MAX_KNOWN_CLIENTS } from "./package-call";

const context = (over: Partial<CallContext> = {}): CallContext => ({
  direction: "incoming",
  line: {
    id: "5c1f8a2e-6b7d-4e3f-9a10-2b3c4d5e6f70",
    name: "Ashwini Bhambani",
    people: [{ name: "Ashwini Bhambani", email: "ashwini@dnyhospitality.com", role: "Account management" }],
  },
  savedName: "Rakesh Cafe 89",
  previouslyBusiness: { type: "client", client: "Cafe 89" },
  speakers: 2,
  oneSided: false,
  knownClients: ["Cafe 89", "Saffron Court Hotel"],
  purgedAt: null,
  ...over,
});

describe("callBlockOf", () => {
  it("describes the line, its people and the other party, never an e-mail, an id or a number", () => {
    expect(callBlockOf(context())).toEqual({
      direction: "incoming",
      line: { name: "Ashwini Bhambani", people: [{ name: "Ashwini Bhambani", role: "Account management" }] },
      counterpart: { savedName: "Rakesh Cafe 89", previousClient: "Cafe 89", previouslyBusiness: "client" },
      speakers: 2,
      oneSided: false,
      knownClients: ["Cafe 89", "Saffron Court Hotel"],
    });
  });

  it("drops phone numbers from every name, and names a line known only by its number", () => {
    const block = callBlockOf(
      context({
        line: { id: "x", name: "+91 98200 00001", people: [{ name: "9820000002", email: "x@dnyhospitality.com", role: null }] },
        savedName: "Rakesh 98201 23456",
        previouslyBusiness: { type: "vendor", client: null },
      }),
    );
    expect(block.line).toEqual({ name: "A DNY phone", people: [] });
    expect(block.counterpart).toEqual({ savedName: "Rakesh", previousClient: null, previouslyBusiness: "vendor" });
    expect(callBlockOf(context({ savedName: "+91 98201 23456", previouslyBusiness: null })).counterpart).toEqual({
      savedName: null,
      previousClient: null,
      previouslyBusiness: null,
    });
  });

  it("caps the known clients at 500 and keeps a one-sided recording visible", () => {
    const many = Array.from({ length: 620 }, (_, i) => `Client ${String(i).padStart(3, "0")}`);
    const block = callBlockOf(context({ knownClients: many, speakers: 1, oneSided: true }));
    expect(block.knownClients).toHaveLength(MAX_KNOWN_CLIENTS);
    expect(block.knownClients[0]).toBe("Client 000");
    expect(block).toMatchObject({ speakers: 1, oneSided: true });
  });
});

describe("callClassificationDecided", () => {
  it("is settled only once the call is a client or vendor call", () => {
    expect(callClassificationDecided("client")).toBe(true);
    expect(callClassificationDecided("vendor")).toBe(true);
    for (const type of ["unknown", "other", "sales", "internal"] as const) expect(callClassificationDecided(type)).toBe(false);
  });
});

describe("languageNoteFor", () => {
  it("tells the routine a call's speaker labels are machine labels", () => {
    expect(languageNoteFor("call", "hinglish", false)).toBe(`Hinglish: Hindi and English mixed, mostly in Latin script. ${CALL_SPEAKERS_NOTE}`);
    expect(languageNoteFor("call", "hindi", true)).toBe(`Mostly Hindi in Devanagari script. ${CALL_SPEAKERS_NOTE}`);
    expect(CALL_SPEAKERS_NOTE).toContain("Speaker 1 and Speaker 2 are machine labels in order of first speech");
  });
  it("keeps a meeting's note as it always was", () => {
    expect(languageNoteFor("meeting", "english", true)).toBe("Mostly English. Speaker labels map to known people.");
    expect(languageNoteFor("meeting", "hinglish", false)).toBe(
      "Hinglish: Hindi and English mixed, mostly in Latin script. Speaker labels are unreliable (fewer than half map to a known person): mark an owner as explicitly assigned only when the name is spoken.",
    );
  });
});
