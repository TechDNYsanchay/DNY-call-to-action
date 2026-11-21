import { describe, expect, it } from "vitest";
import { CLAIM_CUTOFF_MS, END_RESERVE_MS, HOUSEKEEPING_BUDGET_MS, ITEM_BUDGET_MS, POLL_LAST_REQUEST_MS, QUIET_MAX_WAIT_MS, RUN_DEADLINE_MS, TIMEOUT_MS } from "./budget";

describe("the calls job's time budget", () => {
  it("claims new work only during the first 52 s", () => {
    expect(CLAIM_CUTOFF_MS).toBe(52_000);
  });
  it("gives one item time for every step's timeout, a failure's bookkeeping included", () => {
    const { db, download, storageWrite, deepgram } = TIMEOUT_MS;
    // claim, download, upload, promote, sign, Deepgram, save; then, after a failed Deepgram call or save,
    // recording the failure and its log line (or a second try at recording it), each a 6 s step
    expect(ITEM_BUDGET_MS).toBeGreaterThanOrEqual(db + download + storageWrite + db + db + deepgram + db + db + db);
  });
  it("finishes the last item and the end of the run before the deadline, under the 300 s limit", () => {
    expect(CLAIM_CUTOFF_MS + ITEM_BUDGET_MS + END_RESERVE_MS).toBeLessThanOrEqual(RUN_DEADLINE_MS);
    expect(RUN_DEADLINE_MS).toBeLessThan(300_000);
  });
  it("keeps the end reserve big enough for its steps", () => {
    // leftover check (one DB round), a bounded routine start, bookkeeping, unlock
    expect(END_RESERVE_MS).toBeGreaterThanOrEqual(TIMEOUT_MS.db + TIMEOUT_MS.routineStart + TIMEOUT_MS.db + TIMEOUT_MS.db);
  });
  it("lets the poll end well before the claim cutoff's last item", () => {
    expect(POLL_LAST_REQUEST_MS + TIMEOUT_MS.callyzer + TIMEOUT_MS.db).toBeLessThan(RUN_DEADLINE_MS - END_RESERVE_MS);
    expect(QUIET_MAX_WAIT_MS).toBeLessThan(POLL_LAST_REQUEST_MS);
    expect(HOUSEKEEPING_BUDGET_MS).toBeLessThan(CLAIM_CUTOFF_MS);
  });
});
