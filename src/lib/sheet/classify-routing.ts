// Where a meeting goes after the routine classifies it. Pure, so the rule is testable without a
// database: only confident client meetings continue to extraction.

import type { Classification } from "./schema";

export type RoutedStatus = "processing" | "needs_decision" | "skipped";

export interface Routing {
  status: RoutedStatus;
  /** True when the routine should go on and write the sheet in this same run. */
  proceed: boolean;
}

export function routeClassification(type: Classification["type"], confidence: number, threshold: number): Routing {
  if (type !== "client") return { status: "skipped", proceed: false };
  if (confidence >= threshold) return { status: "processing", proceed: true };
  return { status: "needs_decision", proceed: false };
}

/** Case- and whitespace-insensitive client lookup by name; null when nothing matches. */
export function matchClientName<T extends { name: string }>(guess: string | null, clients: T[]): T | null {
  if (!guess) return null;
  const g = guess.trim().toLowerCase();
  if (!g) return null;
  return clients.find((c) => c.name.trim().toLowerCase() === g) ?? null;
}
