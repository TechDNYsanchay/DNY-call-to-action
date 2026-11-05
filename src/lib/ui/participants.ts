// Attendee helpers shared by the review queue, the meeting header and the context rail. Pure.

import { domainOf, isGenericDomain } from "@/lib/ingest/rules";
import type { ParticipantSummary } from "@/lib/data/types";

export type Side = "dny" | "client" | "unknown";

export interface Attendee {
  name: string | null;
  email: string | null;
  side: Side;
  is_organizer: boolean;
}

/** DNY by email; everyone else is on the client side once the meeting is a client meeting. */
export function attendeesOf(participants: ParticipantSummary[], meetingType: string): Attendee[] {
  return participants.map((p) => ({ name: p.name, email: p.email, side: p.is_dny ? "dny" : meetingType === "client" ? "client" : "unknown", is_organizer: p.is_organizer }));
}

/**
 * What a "remember as this client" checkbox would store: company domains of the external invitees,
 * or the full address when the mailbox is a personal one (gmail and friends never identify a client).
 */
export function externalIdentities(participants: Array<Pick<ParticipantSummary, "email" | "is_dny">>): string[] {
  const out = new Set<string>();
  for (const p of participants) {
    if (p.is_dny) continue;
    const domain = domainOf(p.email);
    if (!domain) continue;
    out.add(isGenericDomain(domain) ? p.email.toLowerCase() : domain);
  }
  return [...out];
}

export function groupBySide(attendees: Attendee[]): { dny: Attendee[]; client: Attendee[] } {
  return { dny: attendees.filter((a) => a.side === "dny"), client: attendees.filter((a) => a.side !== "dny") };
}
