// The parts of the routine's work package that differ for a phone call. Pure. A call's package carries what
// the routine needs to tell DNY from the other party and to name a client (the line and its people, the
// contact name saved on the phone, what earlier calls with the same number were, every client's name), and
// never a phone number: names pass through nameWithoutNumber, and the number itself is never read here.

import { type ConversationKind, isEligibleType, type MeetingType } from "@/lib/ingest/decisions";
import { nameWithoutNumber } from "@/lib/phone";
import type { CallContext } from "./load";

/** Client names the routine sees for a call, at most this many (by name). */
export const MAX_KNOWN_CLIENTS = 500;

/** The `call` block of a call's package. */
export interface CallBlock {
  direction: "incoming" | "outgoing";
  /** The DNY phone and the people who use it. */
  /** salesEnquiriesGetSheet: on this line a confident sales answer gets a sheet like a client call. */
  line: { name: string; people: Array<{ name: string; role: string | null }>; salesEnquiriesGetSheet: boolean };
  /** The other party: the contact name saved on the phone, and what earlier calls with this number were. */
  counterpart: { savedName: string | null; previousClient: string | null; previouslyBusiness: "client" | "vendor" | null };
  speakers: number;
  oneSided: boolean;
  knownClients: string[];
}

export function callBlockOf(call: CallContext): CallBlock {
  return {
    direction: call.direction,
    line: {
      name: nameWithoutNumber(call.line.name) ?? "A DNY phone",
      people: call.line.people.map((p) => ({ name: nameWithoutNumber(p.name) ?? "", role: p.role })).filter((p) => p.name),
      salesEnquiriesGetSheet: call.line.salesGetSheets,
    },
    counterpart: {
      savedName: nameWithoutNumber(call.savedName),
      previousClient: nameWithoutNumber(call.previouslyBusiness?.client),
      previouslyBusiness: call.previouslyBusiness?.type ?? null,
    },
    speakers: call.speakers,
    oneSided: call.oneSided,
    knownClients: call.knownClients.slice(0, MAX_KNOWN_CLIENTS),
  };
}

/** A call's type is settled once it is a client or vendor call (by the routine or a person); else it is classified. */
export const callClassificationDecided = (type: MeetingType): boolean => isEligibleType("call", type);

const LANGUAGE_SENTENCES: Record<"english" | "hindi" | "hinglish", string> = {
  english: "Mostly English.",
  hindi: "Mostly Hindi in Devanagari script.",
  hinglish: "Hinglish: Hindi and English mixed, mostly in Latin script.",
};

export const CALL_SPEAKERS_NOTE =
  "A phone call recorded on one DNY phone. Speaker 1 and Speaker 2 are machine labels in order of first speech (one voice is sometimes split into two). Decide from what is said who is DNY; see the guide's Phone calls section.";

/** `language.note`: the transcript's language, then how far its speaker labels can be trusted. */
export function languageNoteFor(kind: ConversationKind, hint: "english" | "hindi" | "hinglish", speakerLabelsReliable: boolean): string {
  if (kind === "call") return `${LANGUAGE_SENTENCES[hint]} ${CALL_SPEAKERS_NOTE}`;
  return [
    LANGUAGE_SENTENCES[hint],
    speakerLabelsReliable ? "Speaker labels map to known people." : "Speaker labels are unreliable (fewer than half map to a known person): mark an owner as explicitly assigned only when the name is spoken.",
  ].join(" ");
}
