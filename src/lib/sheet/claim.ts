// The routine's claim on a call. Pure. claim_next_meeting gives every claim a fresh token that the routine
// echoes as &claim= on classify, save, skip and release, so a run only ever writes the call it claimed: a run
// whose claim timed out, or a call a person took over, gets 409 or 422 instead of overwriting newer work.
// Meetings ignore claims, exactly as before.

import type { ProcessStatus } from "@/lib/ingest/decisions";

export const CLAIM_GONE = "Your claim on this call is missing or was replaced; do not release it, go to the next item";
/** A call that was deleted as not a work call takes no more writes (409, like a lost claim). */
export const CALL_PURGED = "This call was deleted as not a work call";

export interface ClaimRefusal {
  httpStatus: 409 | 422;
  error: string;
}

/** The claim token the routine sent, normalised; null when it sent none. */
export function presentedClaim(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v ? v : null;
}

/**
 * Null when the request may go on: always for a meeting, and for a call's dry run (it writes nothing).
 * Otherwise the call must be 'processing' (422 when not) under the claim the routine presents (409 when the
 * claim is missing or another one is current).
 */
export function checkCallClaim(
  m: { kind: string; process_status: ProcessStatus; claim_token: string | null },
  presented: string | null,
  opts: { dryRun?: boolean } = {},
): ClaimRefusal | null {
  if (m.kind !== "call" || opts.dryRun) return null;
  if (m.process_status !== "processing") return { httpStatus: 422, error: `Call is ${m.process_status}, not processing; call next to claim it` };
  const claim = presentedClaim(presented);
  if (!claim || !m.claim_token || claim !== m.claim_token.toLowerCase()) return { httpStatus: 409, error: CLAIM_GONE };
  return null;
}
