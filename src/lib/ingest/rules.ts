// Rule-based classification at intake (PLAN.md section 7). Pure, so every rule is unit tested.
// The rules decide the easy cases; everything else is 'unknown' and the Claude routine reads the
// transcript. Reasons are written for the card a non-technical reviewer sees.

import { DNY_EMAIL_DOMAIN } from "@/lib/env";
import { formatDuration } from "@/lib/format";

/** Personal mailboxes: being "external" is not a client signal when the domain is one of these. */
export const GENERIC_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.*",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "rediffmail.com",
  "protonmail.com",
  "ymail.com",
] as const;

/** Rule A: shorter than this (seconds) is not a meeting with content. */
export const MIN_DURATION_SEC = 300;
/** Rule A: fewer transcript sentences than this is not a meeting with content. */
export const MIN_SENTENCES = 40;
/** Confidence the rules claim when they decide. */
export const RULE_CONFIDENCE = 0.95;
/** Confidence recorded when the rules leave the decision to the routine. */
export const UNDECIDED_CONFIDENCE = 0.5;

export interface ParticipantLike {
  email: string | null;
  name?: string | null;
}

export interface ClientLike {
  id: string;
  name: string;
  domains: string[];
  contact_emails: string[];
}

export type RuleType = "client" | "other" | "unknown";

export interface RulesInput {
  durationSec: number;
  /** Raw sentence count of the transcript; null before the transcript is stored. */
  sentenceCount: number | null;
  participants: ParticipantLike[];
  clients: ClientLike[];
}

export interface RulesResult {
  type: RuleType;
  source: "rule";
  confidence: number;
  reason: string;
  /** True when a rule settled it (A or B); false means the routine classifies. */
  decided: boolean;
  rule: "A" | "B" | null;
  clientId: string | null;
}

export interface ClientMatch {
  client: ClientLike;
  matchedBy: "email" | "domain";
  /** The participant email (or domain) that matched. */
  value: string;
}

export const domainOf = (email: string | null | undefined): string | null => {
  const at = email?.lastIndexOf("@") ?? -1;
  return at > 0 ? email!.slice(at + 1).toLowerCase().trim() || null : null;
};

/** gmail.com, yahoo.co.in, YAHOO.COM ... */
export function isGenericDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return GENERIC_DOMAINS.some((pattern) => (pattern.endsWith(".*") ? d === pattern.slice(0, -2) || d.startsWith(pattern.slice(0, -1)) : d === pattern));
}

export const isDnyDomain = (domain: string | null | undefined): boolean => domain?.toLowerCase() === DNY_EMAIL_DOMAIN;

/**
 * The first client whose contact list or domains cover a participant. Exact emails win over domains;
 * generic domains never match even if someone put one on a client record by mistake.
 */
export function matchClient(participants: ParticipantLike[], clients: ClientLike[]): ClientMatch | null {
  const emails = participants.map((p) => p.email?.toLowerCase().trim()).filter((e): e is string => !!e);
  for (const client of clients) {
    const contacts = new Set(client.contact_emails.map((e) => e.toLowerCase().trim()));
    const hit = emails.find((e) => contacts.has(e));
    if (hit) return { client, matchedBy: "email", value: hit };
  }
  for (const client of clients) {
    const domains = new Set(client.domains.map((d) => d.toLowerCase().trim()).filter((d) => d && !isGenericDomain(d) && !isDnyDomain(d)));
    const hit = emails.map(domainOf).find((d): d is string => !!d && domains.has(d));
    if (hit) return { client, matchedBy: "domain", value: hit };
  }
  return null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

/** "2 people from gmail.com and 1 from acme.com, none on the client list" (the undecided reason). */
export function describeOutsiders(participants: ParticipantLike[]): string {
  const outside = new Map<string, number>();
  let dny = 0;
  let noEmail = 0;
  for (const p of participants) {
    const d = domainOf(p.email);
    if (!d) noEmail++;
    else if (isDnyDomain(d)) dny++;
    else outside.set(d, (outside.get(d) ?? 0) + 1);
  }
  if (outside.size === 0) {
    const base = dny > 0 ? "Everyone on the invite is from DNY" : "No participant emails were shared";
    return `${base}; the client may have joined from a forwarded link or by phone.`;
  }
  const groups = [...outside.entries()].sort((a, b) => b[1] - a[1]).map(([d, n], i) => (i === 0 ? `${people(n)} from ${d}` : `${n} from ${d}`));
  const list = groups.length <= 2 ? groups.join(" and ") : `${groups.slice(0, -1).join(", ")} and ${groups[groups.length - 1]}`;
  const tail = noEmail > 0 ? `, plus ${people(noEmail)} without an email` : "";
  return `${list}${tail}, none on the client list.`;
}

export function applyRules(input: RulesInput): RulesResult {
  const { durationSec, sentenceCount, participants, clients } = input;
  // Rule A: no content. A duration of 0 means tl;dv did not say, so only a known short duration counts.
  if (durationSec > 0 && durationSec < MIN_DURATION_SEC) {
    return decided("other", "A", `Recording is only ${formatDuration(durationSec)} long; too short to be a real meeting.`);
  }
  if (sentenceCount !== null && sentenceCount < MIN_SENTENCES) {
    return decided("other", "A", `Transcript has only ${plural(sentenceCount, "sentence")}; too short to be a real meeting.`);
  }
  // Rule B: someone from a known client was on the invite.
  const match = matchClient(participants, clients);
  if (match) {
    const reason =
      match.matchedBy === "email"
        ? `${match.value} is on ${match.client.name}'s contact list.`
        : `${match.value} is ${match.client.name}'s domain (${people(participants.filter((p) => domainOf(p.email) === match.value).length)} on the invite).`;
    return { ...decided("client", "B", reason), clientId: match.client.id };
  }
  return { type: "unknown", source: "rule", confidence: UNDECIDED_CONFIDENCE, reason: describeOutsiders(participants), decided: false, rule: null, clientId: null };
}

function decided(type: RuleType, rule: "A" | "B", reason: string): RulesResult {
  return { type, source: "rule", confidence: RULE_CONFIDENCE, reason, decided: true, rule, clientId: null };
}
