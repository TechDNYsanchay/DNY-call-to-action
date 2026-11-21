"use server";

import { requireUser } from "@/lib/auth/require-user";
import { type CallRow, listCalls } from "@/lib/data/calls";
import { type ActionResult, failed, ok } from "@/lib/ui/action-result";
import { type CallsQuery, callsSearchOf, parseCallsQuery } from "@/lib/ui/calls-query";

// The Calls list's search by number. A number never goes in the page's address, where Vercel's request log and
// the browser's history would keep it: the search box sends it here, in the request body, and the list shows
// what comes back. Client and vendor calls only, at least 7 digits; the filters chosen above the list still apply.

export type NumberSearchFilters = Pick<CallsQuery, "filter" | "lineId" | "clientId" | "showNotWork">;

export async function findCallsByNumber(text: string, filters: NumberSearchFilters): Promise<ActionResult<{ rows: CallRow[]; hasMore: boolean }>> {
  try {
    await requireUser();
    const search = callsSearchOf(typeof text === "string" ? text.slice(0, 80) : "");
    if (search?.kind !== "digits") throw new Error("Type at least 7 digits to search by number");
    // The filters as the URL would carry them, so nothing reaches the query unchecked.
    const query = parseCallsQuery({
      filter: filters?.filter,
      line: filters?.lineId ?? undefined,
      client: filters?.clientId ?? undefined,
      notwork: filters?.showNotWork ? "1" : undefined,
    });
    const page = await listCalls(query, { digits: search.digits });
    return ok({ rows: page.rows, hasMore: page.hasMore });
  } catch (e) {
    return failed(e, "The search did not finish. Try again.");
  }
}
