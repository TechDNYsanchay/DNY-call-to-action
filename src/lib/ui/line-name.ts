// The name people see for one of DNY's phone lines. Pure. An admin's label wins; a line with exactly one
// person is that person's phone; otherwise Callyzer's name, title-cased. The number is never used.

import { firstName } from "./text";

export interface LineNaming {
  label: string | null;
  callyzer_name: string;
}

/** "Keyur Dny Supply Chain": the first letter of every word raised, the rest kept as Callyzer wrote it. */
export function titleCaseName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** Admin label -> the sole member's first name + "'s phone" -> Callyzer's name title-cased. */
export function lineDisplayName(line: LineNaming, members: Array<{ full_name: string }>): string {
  const label = line.label?.trim();
  if (label) return label;
  if (members.length === 1) {
    const first = firstName(members[0].full_name);
    if (first) return `${first}'s phone`;
  }
  return titleCaseName(line.callyzer_name) || "Phone line";
}

/**
 * The line with the people who use it, for a call's meta line: "Keyur Dny Supply Chain (Keyur, Meera)".
 * A name that already comes from its one person ("Ashwini's phone") is not repeated.
 */
export function lineWithPeople(line: LineNaming, members: Array<{ full_name: string }>): string {
  const name = lineDisplayName(line, members);
  if (!members.length || (!line.label?.trim() && members.length === 1)) return name;
  const people = members.map((m) => firstName(m.full_name)).filter((n): n is string => Boolean(n));
  return people.length ? `${name} (${people.join(", ")})` : name;
}
