// The idempotency key for a tl;dv delivery: tl;dv's payload id when present, otherwise a stable hash,
// so a retried delivery of the same event is inserted once into webhook_events.

import { createHash } from "node:crypto";
import type { TldvWebhook } from "@/lib/tldv/parse";

export function webhookEventId(hook: Pick<TldvWebhook, "id" | "event" | "meetingId" | "executedAt">): string {
  if (hook.id) return hook.id;
  return "h_" + createHash("sha256").update(`${hook.event}|${hook.meetingId}|${hook.executedAt ?? ""}`).digest("hex").slice(0, 40);
}

/** Events older than this are ignored: a replayed or long-delayed delivery is not worth a sync. */
export const MAX_WEBHOOK_AGE_MS = 24 * 3_600_000;

export function isStaleWebhook(executedAt: string | null, now: Date = new Date()): boolean {
  if (!executedAt) return false;
  const age = now.getTime() - Date.parse(executedAt);
  return Number.isFinite(age) && age > MAX_WEBHOOK_AGE_MS;
}
