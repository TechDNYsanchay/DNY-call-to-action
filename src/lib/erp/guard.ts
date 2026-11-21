import "server-only";

import { CONTRACT } from "@/lib/erp/contract";
import { presentedBearer, secretMatches } from "@/lib/webhooks";

/** A JSON reply that always says which contract it speaks. */
export function erpJson(body: Record<string, unknown>, status = 200): Response {
  return Response.json({ contract: CONTRACT, ...body }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Null when the call carries the ERP's secret; otherwise the reply to send. Fails closed: with no
 * secret configured, nothing is answered.
 */
export function erpGuard(request: Request): Response | null {
  const expected = process.env.ERP_INTEGRATION_SECRET;
  if (!expected) return erpJson({ error: "The ERP integration is not set up." }, 503);
  if (!secretMatches(presentedBearer(request), expected)) return erpJson({ error: "Not authorised." }, 401);
  return null;
}
