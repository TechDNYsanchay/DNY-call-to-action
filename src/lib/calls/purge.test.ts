import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/supabase/server";
import { drainStorageDeletions, purgeCall, QUEUE_WRITE_CHUNK } from "./purge";

// A scripted storage_deletions table: the drain's read answers with the queued paths, and every row write
// (a delete or an update, each with its .in("path", …) list) is recorded and answered by `fail`, if given.

interface Write {
  action: "delete" | "update";
  payload?: Record<string, unknown>;
  paths: string[];
}
type PgError = { code?: string; message: string; details?: string; hint?: string };

function queue(queued: string[], fail?: (write: Write, n: number) => PgError | null) {
  const writes: Write[] = [];
  const answer = async (write: Write) => {
    writes.push(write);
    return { data: null, error: fail?.(write, writes.length) ?? null };
  };
  const db = {
    from: (table: string) => {
      if (table !== "storage_deletions") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ order: () => ({ limit: async (n: number) => ({ data: queued.slice(0, n).map((path) => ({ path })), error: null }) }) }),
        delete: () => ({ in: (_column: string, paths: string[]) => answer({ action: "delete", paths }) }),
        update: (payload: Record<string, unknown>) => ({ in: (_column: string, paths: string[]) => answer({ action: "update", payload, paths }) }),
      };
    },
  } as unknown as Db;
  return { db, writes };
}

const paths = (n: number) => Array.from({ length: n }, (_, i) => `calls/2026/11/${i.toString(16).padStart(32, "0")}-0000abcd`);
const TIMEOUT: PgError = { code: "57014", message: "canceling statement due to statement timeout", details: "rows: calls/2026/11/abc", hint: "hint text" };

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("drainStorageDeletions", () => {
  it("removes the objects in one request and deletes their rows in chunks the gateway accepts", async () => {
    const queued = paths(120);
    const { db, writes } = queue(queued);
    const remove = vi.fn(async () => ({ ok: true }));
    expect(await drainStorageDeletions(db, { limit: 500, remove })).toEqual({ removed: 120, failed: 0 });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(queued);
    expect(writes.map((w) => w.action)).toEqual(["delete", "delete", "delete"]);
    for (const write of writes) expect(write.paths.length).toBeLessThanOrEqual(QUEUE_WRITE_CHUNK);
    expect(writes.flatMap((w) => w.paths)).toEqual(queued);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("counts a chunk whose row delete fails as failed, logs only the error's code and message, and goes on", async () => {
    const queued = paths(120);
    const { db, writes } = queue(queued, (_write, n) => (n === 2 ? TIMEOUT : null));
    const result = await drainStorageDeletions(db, { limit: 500, remove: async () => ({ ok: true }) });
    expect(result).toEqual({ removed: 120 - QUEUE_WRITE_CHUNK, failed: QUEUE_WRITE_CHUNK });
    // The third chunk is still deleted.
    expect(writes).toHaveLength(3);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const line = String(consoleError.mock.calls[0][0]);
    expect(line).toContain(`deleting ${QUEUE_WRITE_CHUNK} rows failed: 57014 canceling statement due to statement timeout`);
    expect(line).not.toContain("rows: calls");
    expect(line).not.toContain("hint text");
  });

  it("records a failed removal on every row, in chunks, with the error text sanitised", async () => {
    const queued = paths(60);
    const { db, writes } = queue(queued);
    const remove = async () => ({ ok: false, error: "Could not reach http://127.0.0.1:54321/storage/v1/object/call-recordings for 9820123456" });
    expect(await drainStorageDeletions(db, { limit: 500, remove })).toEqual({ removed: 0, failed: 60 });
    expect(writes.map((w) => [w.action, w.paths.length])).toEqual([
      ["update", QUEUE_WRITE_CHUNK],
      ["update", 60 - QUEUE_WRITE_CHUNK],
    ]);
    const payload = writes[0].payload as { last_error: string; last_tried_at: string };
    expect(payload.last_error).toContain("[link]");
    expect(payload.last_error).not.toMatch(/https?:\/\/|\d{10}/);
    expect(Number.isFinite(Date.parse(payload.last_tried_at))).toBe(true);
    expect(writes[1].payload).toEqual(payload);
  });

  it("logs an update that fails after a failed removal; every path stays failed", async () => {
    const { db } = queue(paths(10), () => TIMEOUT);
    expect(await drainStorageDeletions(db, { limit: 10, remove: async () => ({ ok: false, error: "storage unavailable" }) })).toEqual({ removed: 0, failed: 10 });
    expect(String(consoleError.mock.calls[0][0])).toContain("recording a failed removal on 10 rows failed: 57014");
  });

  it("treats a removal that throws as failed, and does nothing when the queue is empty", async () => {
    const thrown = queue(paths(3));
    const result = await drainStorageDeletions(thrown.db, { limit: 10, remove: () => Promise.reject(new Error("socket hang up")) });
    expect(result).toEqual({ removed: 0, failed: 3 });
    expect(thrown.writes[0].payload?.last_error).toBe("socket hang up");

    const empty = queue([]);
    const remove = vi.fn(async () => ({ ok: true }));
    expect(await drainStorageDeletions(empty.db, { limit: 10, remove })).toEqual({ removed: 0, failed: 0 });
    expect(remove).not.toHaveBeenCalled();
    expect(empty.writes).toHaveLength(0);
  });
});

// A scripted call for purgeCall: the purged_at read, the purge RPC (recorded, answered by `rpc`), and the
// queue row delete after a removal.
function purgeDb(rpc: (name: string, args: Record<string, unknown>) => { data: string | null; error: PgError | null }, purgedAt: string | null = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  const db = {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "phone_calls" ? { purged_at: purgedAt } : null, error: null }) }) }),
      delete: () => ({
        eq: async (_column: string, path: string) => {
          deleted.push(path);
          return { error: null };
        },
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return rpc(name, args);
    },
  } as unknown as Db;
  return { db, calls, deleted };
}

describe("purgeCall", () => {
  it("purges without a claim through purge_call, and removes the object at once", async () => {
    const { db, calls, deleted } = purgeDb(() => ({ data: "calls/2026/11/abc-0000abcd", error: null }));
    const remove = vi.fn(async () => true);
    expect(await purgeCall(db, "m1", "not_business", { by: "person", byName: "Asha", remove })).toEqual({ purged: true, mediaRemoved: true });
    expect(calls).toEqual([
      { name: "purge_call", args: { p_meeting_id: "m1", p_code: "not_business", p_reason: "Marked not a work call by Asha. The recording, transcript and sheet were deleted.", p_by: "person" } },
    ]);
    expect(remove).toHaveBeenCalledWith("calls/2026/11/abc-0000abcd");
    expect(deleted).toEqual(["calls/2026/11/abc-0000abcd"]);
  });

  it("purges the routine's claimed call through purge_claimed_call, with the fixed reason and summary", async () => {
    const { db, calls } = purgeDb(() => ({ data: null, error: null }));
    const result = await purgeCall(db, "m2", "personal", { by: "routine", claim: "claim-1", summary: "Classified as personal (90%) by the routine" });
    expect(result).toEqual({ purged: true, mediaRemoved: true });
    expect(calls).toEqual([
      {
        name: "purge_claimed_call",
        args: { p_meeting_id: "m2", p_code: "personal", p_reason: "Personal call. The recording and transcript were deleted.", p_summary: "Classified as personal (90%) by the routine", p_claim: "claim-1" },
      },
    ]);
  });

  it("reports a refused claimed purge instead of throwing, and throws on anything else", async () => {
    for (const refusal of ["claim_mismatch", "human_label", "has_sheet", "call_not_found"] as const) {
      const { db } = purgeDb(() => ({ data: null, error: { code: "P0001", message: refusal } }));
      expect(await purgeCall(db, "m3", "personal", { by: "routine", claim: "claim-1" })).toEqual({ purged: false, mediaRemoved: false, refused: refusal });
    }
    const broken = purgeDb(() => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }));
    await expect(purgeCall(broken.db, "m3", "personal", { by: "routine", claim: "claim-1" })).rejects.toThrow("purge_call failed: 57014");
    // Without a claim the same text is an error, as before.
    const unclaimed = purgeDb(() => ({ data: null, error: { code: "P0001", message: "claim_mismatch" } }));
    await expect(purgeCall(unclaimed.db, "m3", "personal", { by: "system" })).rejects.toThrow("purge_call failed: P0001 claim_mismatch");
  });

  it("does nothing for a call that is already purged", async () => {
    const { db, calls } = purgeDb(() => ({ data: null, error: null }), "2026-11-20T10:00:00Z");
    expect(await purgeCall(db, "m4", "personal", { by: "routine", claim: "claim-1" })).toEqual({ purged: false, mediaRemoved: false });
    expect(calls).toEqual([]);
  });
});
