// Where a meeting or a call goes after the routine classifies it. Pure, so the rule is testable without a
// database: only confident client meetings continue to extraction; client and vendor calls always do, and a
// call that is not a work call is deleted only when the routine is sure.

import { callSkipCode, type SkipCode } from "@/lib/calls/skip";
import type { CallClassType, Classification } from "./schema";

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

export type CallRouting = { action: "proceed"; type: "client" | "vendor" } | { action: "purge"; code: SkipCode } | { action: "hold"; kind: "unsure" };

/**
 * A call: client or vendor at any confidence gets a sheet (a doubtful business call costs a sheet; a wrong
 * deletion cannot be undone). Any other type deletes the call only at or above the threshold; below it a
 * person decides.
 */
export function routeCallClassification(type: CallClassType, confidence: number, threshold: number): CallRouting {
  if (type === "client" || type === "vendor") return { action: "proceed", type };
  const code = callSkipCode(type);
  if (!code || !(confidence >= threshold)) return { action: "hold", kind: "unsure" };
  return { action: "purge", code };
}

/** Case- and whitespace-insensitive client lookup by name; null when nothing matches. */
export function matchClientName<T extends { name: string }>(guess: string | null, clients: T[]): T | null {
  if (!guess) return null;
  const g = guess.trim().toLowerCase();
  if (!g) return null;
  return clients.find((c) => c.name.trim().toLowerCase() === g) ?? null;
}
