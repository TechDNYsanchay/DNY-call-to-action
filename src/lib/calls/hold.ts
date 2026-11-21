// When the routine says a call is not a work call but a person should decide anyway. Pure.
// Deleting a call is irreversible, and a transcript or a contact name could be written to steer the
// routine, so a "not work" answer is held for a person, sure or not, when this number had a business call
// before or the saved contact name contains a client's name; a sure answer is also held when the routine
// has deleted more calls than usual in the last hour. (An unsure answer that is none of these waits for a
// person too, but is deleted after calls_decision_hours.)

import { formatTimeIst, IST } from "@/lib/format";
import { normaliseText } from "@/lib/sheet/text";

export type HoldReason = "budget" | "known_number" | "known_name";

export const HOLD_TEXT: Record<HoldReason, string> = {
  known_number: "this number had a client or vendor call before",
  known_name: "the saved contact name contains a client's name",
  budget: "more calls than usual were marked not work calls this hour",
};

/** Client names shorter than this ("DNY", "Taj"), spaces aside, match too much to count. */
const MIN_CLIENT_NAME = 4;

/** Whether a client's name (normalised, at least 4 characters) is contained in the saved contact name. */
export function isKnownBusinessName(savedName: string | null, clientNames: string[]): boolean {
  const saved = savedName ? normaliseText(savedName) : "";
  if (!saved) return false;
  return clientNames.some((name) => {
    const client = normaliseText(name);
    return client.replace(/\s/g, "").length >= MIN_CLIENT_NAME && saved.includes(client);
  });
}

/** What is known about the other party before the routine's answer: an earlier call, the saved name, every client's name. */
export interface KnownParty {
  previouslyBusiness: { type: "client" | "vendor"; client: string | null } | null;
  savedName: string | null;
  clientNames: string[];
}

/** Why the party looks like business whatever the routine said: a business call before from this number, then a client's name. */
export function knownBusinessReason(i: KnownParty): Exclude<HoldReason, "budget"> | null {
  if (i.previouslyBusiness) return "known_number";
  if (isKnownBusinessName(i.savedName, i.clientNames)) return "known_name";
  return null;
}

/** For a sure answer, checked in this order: a business call before from this number, a client's name, then the hourly budget. */
export function holdReasonFor(i: KnownParty & { routinePurgesLastHour: number; budgetPerHour: number }): HoldReason | null {
  return knownBusinessReason(i) ?? (i.routinePurgesLastHour >= i.budgetPerHour ? "budget" : null);
}

/** "93%": the routine's confidence as people read it. */
export const percentOf = (confidence: number): string => `${Math.round(confidence * 100)}%`;

/** A held call's reason on its page (meetings.type_reason): fixed text, nothing the routine wrote. */
export const heldText = (reason: HoldReason): string => `Held for a person: ${HOLD_TEXT[reason]}`;

const DAY_MONTH = new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short" });

/**
 * An unsure call's reason: when it is deleted unless someone decides (calls_decision_hours from now, in
 * IST), e.g. "The routine was not sure this is a work call (60%). It is deleted at 11:52, 22 Nov unless
 * someone decides."
 */
export function unsureText(confidence: number, decisionHours: number, now: Date): string {
  const at = new Date(now.getTime() + decisionHours * 3_600_000);
  return `The routine was not sure this is a work call (${percentOf(confidence)}). It is deleted at ${formatTimeIst(at)}, ${DAY_MONTH.format(at)} unless someone decides.`;
}

/** The one alert per hour when the purge budget holds calls for a person. */
export const BUDGET_ALERT_PREFIX = "Routine purges paused for an hour";
export const budgetAlertText = (held: number): string => `${BUDGET_ALERT_PREFIX}: ${held} ${held === 1 ? "call" : "calls"} held for a person`;
