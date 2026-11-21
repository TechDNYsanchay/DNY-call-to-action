import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/supabase/server";
import { NIGHTLY_DRAIN_LIMIT, orphanPaths, runCallsRetention, sweepFolders } from "./retention";
import { DEFAULT_CALLS_SETTINGS } from "./settings";

describe("sweepFolders", () => {
  it("lists this and last month by the IST month", () => {
    expect(sweepFolders(new Date("2026-11-21T05:00:00Z"))).toEqual(["calls/2026/11", "calls/2026/10"]);
    // 20:00 UTC on 31 Dec is already January in India.
    expect(sweepFolders(new Date("2026-12-31T20:00:00Z"))).toEqual(["calls/2027/01", "calls/2026/12"]);
    expect(sweepFolders(new Date("2027-01-15T05:00:00Z"))).toEqual(["calls/2027/01", "calls/2026/12"]);
  });
});

describe("orphanPaths", () => {
  const now = new Date("2026-11-21T21:30:00Z");
  it("takes objects older than a day that nothing references", () => {
    const objects = [
      { path: "calls/2026/11/a-00000001", createdAt: "2026-11-19T10:00:00Z" },
      { path: "calls/2026/11/b-00000002", createdAt: "2026-11-21T10:00:00Z" },
      { path: "calls/2026/11/c-00000003", createdAt: "2026-11-01T10:00:00Z" },
      { path: "calls/2026/11/d-00000004", createdAt: null },
    ];
    expect(orphanPaths(objects, new Set(["calls/2026/11/c-00000003"]), now)).toEqual(["calls/2026/11/a-00000001"]);
  });
});

// A scripted database: the retention RPCs, one storage folder listing, the two reference reads and the
// deletion queue. Records what was asked.
function scripted(opts: { undecided?: number[]; failAudio?: boolean; objects?: Array<{ name: string; created_at: string }>; referenced?: string[]; queued?: string[] }) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const inserted: Array<{ path: string; reason: string }> = [];
  const undecided = [...(opts.undecided ?? [0])];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      if (name === "expire_undecided_calls") return { data: undecided.shift() ?? 0, error: null };
      if (name === "expire_call_audio") return opts.failAudio ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } : { data: 2, error: null };
      if (name === "cleanup_call_log") return { data: 3, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
    storage: {
      from: () => ({
        list: async (folder: string) => ({
          data: folder === "calls/2026/11" ? (opts.objects ?? []).map((o) => ({ id: o.name, name: o.name, created_at: o.created_at })) : [],
          error: null,
        }),
        remove: async (paths: string[]) => ({ data: paths.map((name) => ({ name })), error: null }),
      }),
    },
    from: (table: string) => {
      const reads = {
        select: () => {
          const query = {
            in: (column: string, values: string[]) => {
              if (column === "status") return query;
              const hits = values.filter((v) => (opts.referenced ?? []).includes(v));
              return Promise.resolve({ data: hits.map((v) => ({ [column]: v })), error: null });
            },
            order: () => ({ limit: async () => ({ data: (opts.queued ?? []).map((path) => ({ path })), error: null }) }),
          };
          return query;
        },
        upsert: async (rows: Array<{ path: string; reason: string }>) => {
          inserted.push(...rows);
          return { error: null };
        },
        delete: () => ({ in: async () => ({ error: null }) }),
      };
      if (!["phone_calls", "call_log", "storage_deletions"].includes(table)) throw new Error(`unexpected table ${table}`);
      return reads;
    },
  } as unknown as Db;
  return { db, rpcs, inserted };
}

describe("runCallsRetention", () => {
  const now = new Date("2026-11-21T21:30:00Z");
  const settings = { ...DEFAULT_CALLS_SETTINGS, audioRetentionDays: 30, decisionHours: 24, undecidedFailedDays: 3 };

  it("deletes undecided calls while a batch comes back full, then the audio, the ledger, the orphans and the queue", async () => {
    const { db, rpcs, inserted } = scripted({
      undecided: [50, 50, 7],
      objects: [
        { name: "old-orphan", created_at: "2026-11-19T10:00:00Z" },
        { name: "old-call", created_at: "2026-11-02T10:00:00Z" },
        { name: "fresh-upload", created_at: "2026-11-21T21:00:00Z" },
      ],
      referenced: ["calls/2026/11/old-call"],
      queued: ["calls/2026/11/old-orphan", "calls/2026/10/x"],
    });
    const result = await runCallsRetention(db, { now, settings });
    expect(result).toEqual({ undecidedDeleted: 107, audioExpired: 2, ledgerCleaned: 3, orphansQueued: 1, objectsRemoved: 2, objectRemovalsFailed: 0, errors: [] });
    expect(rpcs.map((r) => r.name)).toEqual(["expire_undecided_calls", "expire_undecided_calls", "expire_undecided_calls", "expire_call_audio", "cleanup_call_log"]);
    expect(rpcs[0].args).toEqual({ p_decision_hours: 24, p_failed_days: 3, p_max_days: 30 });
    expect(rpcs[3].args).toEqual({ p_days: 30 });
    expect(rpcs[4].args).toEqual({ p_days: 14 });
    expect(inserted).toEqual([{ path: "calls/2026/11/old-orphan", reason: "orphan" }]);
    expect(NIGHTLY_DRAIN_LIMIT).toBe(500);
  });

  it("reports a failed step without its details and still runs the others", async () => {
    const { db, rpcs } = scripted({ failAudio: true });
    const result = await runCallsRetention(db, { now, settings });
    expect(result.errors).toEqual(["recordings past retention: 57014 canceling statement due to statement timeout"]);
    expect(rpcs.map((r) => r.name)).toContain("cleanup_call_log");
    expect(result.ledgerCleaned).toBe(3);
  });
});
