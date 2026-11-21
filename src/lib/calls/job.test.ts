import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutineStart } from "@/lib/routine";
import type { Json } from "@/lib/supabase/database.types";
import type { Db } from "@/lib/supabase/server";
import historyPage from "@/lib/callyzer/fixtures/call-history-page.json";
import { CLAIM_CUTOFF_MS, END_RESERVE_MS, RUN_DEADLINE_MS, TIMEOUT_MS } from "./budget";
import type { CallsDeps } from "./deps";
import fiveWords from "./fixtures/deepgram-five-words.json";
import response from "./fixtures/deepgram-response.json";
import { runCallsJob } from "./job";
import { MEDIA_MAX_ATTEMPTS } from "./worker";

// A scripted database and outside world. Every query, RPC and storage call is recorded with the fake
// clock's time; the clock only moves when the code sleeps or a scripted answer moves it.

type Result = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
interface Query {
  table: string;
  action: "select" | "update" | "insert" | "upsert" | "delete";
  columns?: string;
  payload?: unknown;
  options?: unknown;
  filters: unknown[][];
}
type Op = ({ kind: "query" } & Query & { at: number }) | { kind: "rpc"; name: string; args: Record<string, unknown>; at: number } | { kind: "storage"; method: string; args: unknown[]; at: number };

interface WorkItem {
  work: string;
  callyzer_id?: string | null;
  meeting_id?: string | null;
  recording_url?: string | null;
  storage_path?: string | null;
  duration_sec?: number | null;
  attempt?: number | null;
}

interface Script {
  start?: string;
  settings?: Record<string, Json>;
  prev?: Record<string, unknown> | null;
  lockHeld?: boolean;
  env?: Partial<CallsDeps["env"]>;
  /** claim_call_work answers, by call number (1-based); null or missing = nothing to do. */
  claims?: Array<WorkItem | null>;
  rpc?: Record<string, (args: Record<string, unknown>) => Result | Promise<Result>>;
  query?: (q: Query) => Result | Promise<Result> | undefined;
  sign?: (path: string) => Result | Promise<Result>;
  /** Answers for fetch by host; the default serves an empty call-history page, an MP3 and the Deepgram fixture. */
  fetch?: Record<string, (url: string, init?: RequestInit) => Response | Promise<Response>>;
  startRoutine?: () => Promise<RoutineStart>;
}

const LINES = [
  { id: "line-ashwini", phone: "+919820000001", enabled: true, analyse_from: "2026-11-18T00:00:00Z", callyzer_name: "Ashwini Bhambani" },
  { id: "line-keyur", phone: "+919820000002", enabled: true, analyse_from: "2026-11-18T00:00:00Z", callyzer_name: "keyur dny supply chain" },
  { id: "line-support", phone: "+919820000003", enabled: false, analyse_from: null, callyzer_name: "support" },
];

const mp3 = (size: number) => {
  const out = new Uint8Array(size);
  out.set([0x49, 0x44, 0x33, 4, 0]);
  return out;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const emptyPage = () => json({ data: [], message: "Success", recordsTotal: 0 });

function harness(script: Script = {}) {
  let t = Date.parse(script.start ?? "2026-11-19T10:04:00Z");
  const ops: Op[] = [];
  const logs: Array<{ level: string; step: string; message: string }> = [];
  const fetched: string[] = [];
  let claimNo = 0;
  const settings: Record<string, Json> = { calls_paused: false, pipeline_paused: false, max_attempts: 3, ...script.settings };

  const defaultQuery = (q: Query): Result => {
    const has = (name: string) => q.filters.some((f) => f[0] === name);
    switch (q.table) {
      case "settings":
        return { data: Object.entries(settings).map(([key, value]) => ({ key, value })) };
      case "sync_state":
        if (q.action === "update" && (q.payload as { locked_until?: unknown }).locked_until !== undefined && q.columns) {
          return { data: script.lockHeld ? [] : [{ last_synced_at: null, value: script.prev ?? null }] };
        }
        if (q.action === "select") return { data: q.columns === "key" ? { key: "callyzer" } : { value: script.prev ?? null } };
        return { data: null };
      case "phone_lines":
        return { data: LINES.map(({ id, phone, enabled, analyse_from }) => ({ id, phone, enabled, analyse_from })) };
      case "meetings":
        if (has("not")) return { data: [] };
        return { data: [{ id: "m-ready", phone_calls: { ready_at: new Date(t).toISOString() } }] };
      default:
        return { data: q.action === "select" ? [] : null };
    }
  };

  const defaultRpc: Record<string, (args: Record<string, unknown>) => Result> = {
    register_phone_lines: () => ({ data: [] }),
    upsert_call_log: (args) => ({ data: (args.p_rows as Array<{ callyzer_id: string }>).map((r) => ({ callyzer_id: r.callyzer_id, status: "pending", inserted: true })) }),
    claim_call_work: () => {
      claimNo++;
      const item = script.claims?.[claimNo - 1];
      return { data: item ? [{ callyzer_id: null, meeting_id: null, recording_url: null, storage_path: null, duration_sec: null, attempt: 1, ...item }] : [] };
    },
    promote_call: (args) => ({ data: [{ meeting_id: `m-${args.p_callyzer_id}`, outcome: args.p_transcribe ? "transcribe" : "wait" }] }),
    save_call_transcript: (args) => ({ data: [(args.p_words as number) < 8 ? { status: "no_speech", purge_path: `calls/2026/11/${args.p_meeting_id}-gone` } : { status: "ready", purge_path: null }] }),
    finish_call_copy: () => ({ data: "retry" }),
    finish_call_transcription: () => ({ data: "retry" }),
    release_stale_call_claims: () => ({ data: 0 }),
    expire_call_recordings: () => ({ data: 0 }),
    expire_undecided_calls: () => ({ data: 0 }),
  };

  const settle = (run: () => Result | Promise<Result> | undefined, fallback: () => Result) =>
    Promise.resolve()
      .then(run)
      .then((r) => ({ data: null, error: null, ...(r ?? fallback()) }));

  const from = (table: string) => {
    const q: Query = { table, action: "select", filters: [] };
    let acted = false;
    const builder: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== "string") return undefined;
          if (prop === "then") {
            return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
              ops.push({ kind: "query", ...q, at: t });
              settle(() => script.query?.(q), () => defaultQuery(q)).then(resolve, reject);
            };
          }
          return (...args: unknown[]) => {
            if (prop === "select" && acted) q.columns = args[0] as string;
            else if (prop === "select") q.columns = args[0] as string;
            else if (prop === "update" || prop === "insert" || prop === "upsert" || prop === "delete") {
              q.action = prop;
              q.payload = args[0];
              q.options = args[1];
              acted = true;
            } else q.filters.push([prop, ...args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };

  const storageCall = (method: string, args: unknown[], answer: () => Result | Promise<Result>) => {
    ops.push({ kind: "storage", method, args, at: t });
    return settle(answer, () => ({ data: null }));
  };

  const db = {
    from,
    rpc: (name: string, args: Record<string, unknown>) => {
      ops.push({ kind: "rpc", name, args, at: t });
      return settle(() => (script.rpc?.[name] ?? defaultRpc[name] ?? (() => ({ data: null })))(args), () => ({ data: null }));
    },
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => storageCall("upload", args, () => ({ data: { path: args[0] } })),
        createSignedUrl: (...args: unknown[]) =>
          storageCall("createSignedUrl", args, () =>
            script.sign ? script.sign(args[0] as string) : { data: { signedUrl: `http://127.0.0.1:54321/storage/v1/object/sign/call-recordings/${args[0]}?token=eyJsecret` } },
          ),
        remove: (...args: unknown[]) => storageCall("remove", args, () => ({ data: [] })),
      }),
    },
  } as unknown as Db;

  const hosts: Record<string, (url: string, init?: RequestInit) => Response | Promise<Response>> = {
    "sandbox.api.callyzer.co": emptyPage,
    "media1.callyzer.co": () => new Response(new Blob([mp3(600_000) as BlobPart]), { status: 200, headers: { "content-type": "audio/mpeg" } }),
    "api.deepgram.com": () => json(response),
    ...script.fetch,
  };
  const startRoutine = vi.fn(script.startRoutine ?? (async (): Promise<RoutineStart> => "started"));
  const removeObjects = vi.fn(async (paths: string[]) => (paths.length ? { ok: true } : { ok: true }));
  const deps: CallsDeps = {
    db,
    now: () => new Date(t),
    sleep: async (ms) => void (t += ms),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      fetched.push(url);
      const answer = hosts[new URL(url).hostname];
      if (!answer) throw new Error(`unexpected host ${url}`);
      return answer(url, init);
    }) as typeof fetch,
    env: { callyzerBase: "https://sandbox.api.callyzer.co", callyzerKey: "cz-key", deepgramKey: "dg-key", supabaseUrl: "http://127.0.0.1:54321", ...script.env },
    startRoutine,
    log: async (level, step, message) => void logs.push({ level, step, message }),
    removeObjects,
  };

  const rpcs = (name: string) => ops.filter((o): o is Extract<Op, { kind: "rpc" }> => o.kind === "rpc" && o.name === name);
  const queries = (table: string) => ops.filter((o): o is Extract<Op, { kind: "query" }> => o.kind === "query" && o.table === table);
  /** The job's final write of sync_state['callyzer'] (the one that frees the lock). */
  const bookkeeping = () => {
    const write = queries("sync_state").filter((q) => q.action === "update" && (q.payload as Record<string, unknown>).value !== undefined).at(-1);
    return write ? (write.payload as { value: Record<string, unknown>; locked_until?: null; last_synced_at?: string }) : null;
  };
  return { deps, ops, logs, fetched, startRoutine, removeObjects, rpcs, queries, bookkeeping, advance: (ms: number) => void (t += ms), startedAt: Date.parse(script.start ?? "2026-11-19T10:04:00Z") };
}

const copyItem = (id: string, extra: Partial<WorkItem> = {}): WorkItem => ({
  work: "copy",
  callyzer_id: id,
  recording_url: `https://media1.callyzer.co/recordings/2026/11/19/${id}.mp3`,
  storage_path: `calls/2026/11/${id}-0000abcd`,
  duration_sec: 120,
  ...extra,
});
const transcribeItem = (meetingId: string): WorkItem => ({ work: "transcribe", callyzer_id: `cz-${meetingId}`, meeting_id: meetingId, storage_path: `calls/2026/11/${meetingId}-1111abcd`, duration_sec: 147 });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("off switches", () => {
  it("tripwire: a database that is not this app's runs nothing at all", async () => {
    const h = harness({ env: { supabaseUrl: "https://abcdefghijklmnop.supabase.co" } });
    expect((await runCallsJob(h.deps)).off).toBe("tripwire");
    expect(h.ops).toHaveLength(0);
    expect(h.fetched).toHaveLength(0);
  });
  it("paused: no Callyzer request, no copies, but undecided calls expire and the deletion queue drains", async () => {
    const h = harness({ settings: { calls_paused: true } });
    const result = await runCallsJob(h.deps);
    expect(result.off).toBe("paused");
    expect(h.fetched).toHaveLength(0);
    expect(h.ops.filter((o) => o.kind === "rpc").map((o) => (o as { name: string }).name)).toEqual(["expire_undecided_calls"]);
    expect(h.queries("storage_deletions").some((q) => q.action === "select")).toBe(true);
    const write = h.bookkeeping();
    expect(write?.value.off).toBe("paused");
    // Recorded only while no run holds the lock.
    expect(h.queries("sync_state").at(-1)?.filters.some((f) => f[0] === "or" && String(f[1]).includes("locked_until"))).toBe(true);
  });
  it("not configured: records the switch and names only the missing keys, once", async () => {
    const h = harness({ env: { deepgramKey: undefined } });
    expect((await runCallsJob(h.deps)).off).toBe("not_configured");
    expect(h.fetched).toHaveLength(0);
    expect(h.bookkeeping()?.value.off).toBe("not_configured");
    expect(h.rpcs("expire_undecided_calls")).toHaveLength(1);
    const warnings = h.logs.filter((l) => l.message.includes("not configured"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("DEEPGRAM_API_KEY");
    expect(warnings[0].message).not.toContain("CALLYZER");
    // Already recorded: not logged again.
    const again = harness({ env: { deepgramKey: undefined }, prev: { off: "not_configured" } });
    await runCallsJob(again.deps);
    expect(again.logs.filter((l) => l.message.includes("not configured"))).toHaveLength(0);
  });
  it("lock held: the run is skipped", async () => {
    const h = harness({ lockHeld: true });
    expect((await runCallsJob(h.deps)).skipped).toBe("locked");
    expect(h.ops.filter((o) => o.kind === "rpc")).toHaveLength(0);
    expect(h.fetched).toHaveLength(0);
  });
});

describe("the poll", () => {
  it("registers lines, re-reads them, then writes only the candidates to the ledger", async () => {
    const h = harness({ fetch: { "sandbox.api.callyzer.co": () => json(historyPage) } });
    const result = await runCallsJob(h.deps);
    expect(result.poll).toBe("ok");
    const at = (pred: (o: Op) => boolean) => h.ops.findIndex(pred);
    const register = at((o) => o.kind === "rpc" && o.name === "register_phone_lines");
    const reread = at((o) => o.kind === "query" && o.table === "phone_lines");
    const upsert = at((o) => o.kind === "rpc" && o.name === "upsert_call_log");
    expect(register).toBeGreaterThanOrEqual(0);
    expect(register).toBeLessThan(reread);
    expect(reread).toBeLessThan(upsert);
    // Every line in the batch is registered, the off one too, with no number in its name.
    const registered = h.rpcs("register_phone_lines")[0].args.p_lines as Array<{ phone: string; name: string }>;
    expect(new Set(registered.map((l) => l.phone))).toEqual(new Set(["+919820000001", "+919820000002", "+919820000003"]));
    // Fixture rows 1 (Ashwini, 323 s), 5 (keyur, 90 s, no link yet) and 6 (keyur, 60 s): the rest are short,
    // internal, on an off line, not connected or too long.
    const ledger = h.rpcs("upsert_call_log")[0].args.p_rows as Array<{ callyzer_id: string; counterpart_masked: string; recording_url: string | null }>;
    expect(ledger.map((r) => r.callyzer_id).sort()).toEqual(
      [historyPage.data[0].uniqueId.trim(), historyPage.data[4].uniqueId, historyPage.data[5].uniqueId].sort(),
    );
    expect(ledger.find((r) => r.callyzer_id === historyPage.data[0].uniqueId.trim())?.counterpart_masked).toBe("+91 98••• ••456");
    const write = h.bookkeeping();
    expect(write?.last_synced_at).toBeTruthy();
    expect(write?.locked_until).toBeNull();
    const today = write?.value.today as { day: string; candidates: number; onLines: number };
    expect(today.day).toBe("2026-11-19");
    expect(today.candidates).toBe(3);
    expect(write?.value.lastWideReadAt).toBeTruthy();
  });
  it("reads a requested day and closes the request only after its window came back", async () => {
    const h = harness({
      query: (q) => (q.table === "call_reread_requests" && q.action === "select" ? { data: [{ day: "2026-11-12" }] } : undefined),
    });
    await runCallsJob(h.deps);
    const bodies = h.fetched.length;
    expect(bodies).toBe(2);
    const closed = h.queries("call_reread_requests").find((q) => q.action === "update");
    expect(closed?.filters).toContainEqual(["in", "day", ["2026-11-12"]]);
  });
  it("holds polling for 15 minutes after a refused key and alerts once at the third failure", async () => {
    const h = harness({ prev: { pollError: "auth", pollFailures: 2 }, fetch: { "sandbox.api.callyzer.co": () => new Response("nope", { status: 401 }) } });
    const result = await runCallsJob(h.deps);
    expect(result.poll).toBe("error: auth");
    const value = h.bookkeeping()?.value as Record<string, unknown>;
    expect(value.pollFailures).toBe(3);
    expect(value.pollAlerted).toBe(true);
    expect(Date.parse(String(value.pollHoldUntil)) - h.startedAt).toBeGreaterThanOrEqual(15 * 60_000);
    expect(h.bookkeeping()?.last_synced_at).toBeUndefined();
    expect(h.logs.filter((l) => l.level === "error" && l.message.startsWith("Callyzer:"))).toHaveLength(1);
    // The next run, inside the hold, sends nothing.
    const next = harness({ prev: value, fetch: { "sandbox.api.callyzer.co": () => new Response("nope", { status: 401 }) } });
    expect((await runCallsJob(next.deps)).poll).toBe("hold");
    expect(next.fetched).toHaveLength(0);
  });
  it("writes the bookkeeping even when the poll throws, and the workers still finish", async () => {
    const h = harness({
      fetch: { "sandbox.api.callyzer.co": () => json(historyPage) },
      query: (q) => {
        if (q.table === "phone_lines") throw new Error("connection reset");
        return undefined;
      },
      claims: [copyItem("c1")],
    });
    const result = await runCallsJob(h.deps);
    expect(result.poll).toBe("error");
    expect(h.rpcs("promote_call")).toHaveLength(1);
    expect(h.rpcs("save_call_transcript")).toHaveLength(1);
    const write = h.bookkeeping();
    expect(write?.locked_until).toBeNull();
    expect(write?.last_synced_at).toBeUndefined();
    expect(h.logs.some((l) => l.level === "error" && l.message.includes("poll stopped"))).toBe(true);
  });
});

describe("the workers", () => {
  it("claim nothing new after the first 52 s of the run", async () => {
    const h = harness({
      claims: Array.from({ length: 50 }, (_, i) => transcribeItem(`m${i}`)),
      fetch: {
        "api.deepgram.com": () => {
          h.advance(25_000);
          return json(response);
        },
      },
    });
    await runCallsJob(h.deps);
    const claims = h.rpcs("claim_call_work");
    expect(claims.length).toBeGreaterThan(2);
    expect(claims.length).toBeLessThan(10);
    for (const claim of claims) expect(claim.at - h.startedAt).toBeLessThanOrEqual(CLAIM_CUTOFF_MS);
  });
  it("count the settings read and the lock against the claim cutoff", async () => {
    const h = harness({
      claims: Array.from({ length: 50 }, (_, i) => transcribeItem(`m${i}`)),
      query: (q) => {
        // Both at their 6 s timeout.
        if (q.table === "settings" || (q.table === "sync_state" && q.action === "update" && q.columns)) h.advance(TIMEOUT_MS.db);
        return undefined;
      },
      fetch: {
        "api.deepgram.com": () => {
          h.advance(25_000);
          return json(response);
        },
      },
    });
    await runCallsJob(h.deps);
    const claims = h.rpcs("claim_call_work");
    expect(claims[0].at - h.startedAt).toBe(2 * TIMEOUT_MS.db);
    for (const claim of claims) expect(claim.at - h.startedAt).toBeLessThanOrEqual(CLAIM_CUTOFF_MS);
    expect(h.bookkeeping()?.value.lastRunAt).toBe(new Date(h.startedAt).toISOString());
  });
  it("cap copies and transcription at 3 counted attempts, whatever the routine's max_attempts", async () => {
    const h = harness({
      settings: { max_attempts: 7 },
      claims: [copyItem("c1"), transcribeItem("m2")],
      fetch: {
        "media1.callyzer.co": () => new Response("not found", { status: 404 }),
        "api.deepgram.com": () => new Response("unavailable", { status: 503 }),
      },
    });
    await runCallsJob(h.deps);
    expect(h.rpcs("finish_call_copy")).toHaveLength(1);
    expect(h.rpcs("finish_call_transcription")).toHaveLength(1);
    const media = [...h.rpcs("claim_call_work"), ...h.rpcs("finish_call_copy"), ...h.rpcs("finish_call_transcription")];
    for (const op of media) expect(op.args.p_max_attempts).toBe(MEDIA_MAX_ATTEMPTS);
    expect(MEDIA_MAX_ATTEMPTS).toBe(3);
    // The routine's own claims on calls follow the setting.
    expect(h.rpcs("release_stale_call_claims")[0].args.p_max_attempts).toBe(7);
  });
  it("copy, store with a 60 s cache, promote and transcribe in one go", async () => {
    const h = harness({ claims: [copyItem("c1")] });
    const result = await runCallsJob(h.deps);
    const upload = h.ops.find((o) => o.kind === "storage" && o.method === "upload") as { args: unknown[] };
    expect(upload.args[0]).toBe("calls/2026/11/c1-0000abcd");
    expect(upload.args[2]).toEqual({ contentType: "audio/mpeg", upsert: true, cacheControl: "60" });
    expect(h.rpcs("promote_call")[0].args).toMatchObject({ p_callyzer_id: "c1", p_recording_path: "calls/2026/11/c1-0000abcd", p_mime: "audio/mpeg", p_bytes: 600_000, p_playable: true, p_transcribe: true });
    const saved = h.rpcs("save_call_transcript")[0].args;
    expect(saved).toMatchObject({ p_meeting_id: "m-c1", p_provider: "deepgram:nova-3", p_min_words: 8, p_audio_sec: 147.2, p_speakers: 2 });
    expect((saved.p_turns as Array<{ speaker: string }>)[0].speaker).toBe("Speaker 1");
    expect(result.copied).toBe(1);
    expect(result.transcribed).toBe(1);
    expect(h.bookkeeping()?.value.lastTranscribedAt).toBeTruthy();
  });
  it("marks a stub empty without uploading it or calling Deepgram", async () => {
    const h = harness({
      claims: [copyItem("c1", { duration_sec: 60 })],
      fetch: { "media1.callyzer.co": () => new Response(new Blob([mp3(8_000) as BlobPart]), { status: 200, headers: { "content-type": "audio/mpeg" } }) },
    });
    const result = await runCallsJob(h.deps);
    expect(h.rpcs("finish_call_copy")[0].args).toMatchObject({ p_callyzer_id: "c1", p_outcome: "empty", p_bytes: 8_000 });
    expect(h.ops.some((o) => o.kind === "storage" && o.method === "upload")).toBe(false);
    expect(h.fetched.some((u) => u.includes("deepgram"))).toBe(false);
    expect(result.emptyRecordings).toBe(1);
  });
  it("after Deepgram refuses the key, later claims and promotions are copy-only", async () => {
    const h = harness({
      claims: [transcribeItem("m1"), null, copyItem("c2")],
      fetch: { "api.deepgram.com": () => json({ err_code: "INVALID_AUTH", err_msg: "Invalid credentials." }, 401) },
    });
    await runCallsJob(h.deps);
    expect(h.rpcs("finish_call_transcription")[0].args).toMatchObject({ p_meeting_id: "m1", p_outcome: "not_billed", p_error_kind: "auth" });
    const claims = h.rpcs("claim_call_work");
    const failedAt = h.ops.indexOf(h.rpcs("finish_call_transcription")[0]);
    const later = claims.filter((c) => h.ops.indexOf(c) > failedAt);
    expect(later.length).toBeGreaterThan(0);
    for (const claim of later) expect(claim.args.p_transcribe).toBe(false);
    expect(h.rpcs("promote_call")[0].args.p_transcribe).toBe(false);
    expect(h.bookkeeping()?.value.sttError).toBe("auth");
    expect(h.logs.filter((l) => l.level === "error" && l.message.includes("Deepgram refused the API key"))).toHaveLength(1);
  });
  it("at today's cap, later claims are copy-only", async () => {
    const h = harness({ claims: [{ work: "cap", meeting_id: "m1" }, null, copyItem("c2")] });
    await runCallsJob(h.deps);
    const claims = h.rpcs("claim_call_work");
    expect(claims[2].args.p_transcribe).toBe(false);
    expect(h.rpcs("promote_call")[0].args.p_transcribe).toBe(false);
    expect(h.bookkeeping()?.value.sttError).toBe("cap");
  });
  it("an exception after promote_call fails the transcription attempt, not the copy", async () => {
    const h = harness({
      claims: [copyItem("c1")],
      sign: () => {
        throw new Error("socket hang up");
      },
    });
    await runCallsJob(h.deps);
    expect(h.rpcs("finish_call_transcription")[0].args).toMatchObject({ p_meeting_id: "m-c1", p_outcome: "transient", p_error_kind: "internal" });
    expect(h.rpcs("finish_call_copy")).toHaveLength(0);
  });
  it("an exception before promote_call gives the copy back as transient", async () => {
    const h = harness({
      claims: [copyItem("c1")],
      rpc: {
        promote_call: () => {
          throw new Error("canceling statement due to statement timeout");
        },
      },
    });
    await runCallsJob(h.deps);
    expect(h.rpcs("finish_call_copy")[0].args).toMatchObject({ p_callyzer_id: "c1", p_outcome: "transient", p_error_kind: "internal" });
    expect(h.rpcs("finish_call_transcription")).toHaveLength(0);
  });
  it("three copy failures in a row raise exactly one alert", async () => {
    const h = harness({
      claims: [copyItem("c1"), copyItem("c2"), copyItem("c3"), copyItem("c4")],
      fetch: { "media1.callyzer.co": () => new Response("not found", { status: 404 }) },
    });
    await runCallsJob(h.deps);
    expect(h.rpcs("finish_call_copy").map((o) => o.args.p_outcome)).toEqual(["content", "content", "content", "content"]);
    expect(h.logs.filter((l) => l.message.startsWith("Recordings can't be copied"))).toHaveLength(1);
    const value = h.bookkeeping()?.value as { copyError: { kind: string; host?: string }; copyFailuresInARow: number; copyAlerted: boolean };
    expect(value.copyError.kind).toBe("http");
    expect(value.copyError.host).toBeUndefined();
    expect(value.copyFailuresInARow).toBe(4);
    expect(value.copyAlerted).toBe(true);
  });
  it("removes a no-speech recording at once", async () => {
    const h = harness({
      claims: [transcribeItem("m1")],
      fetch: { "api.deepgram.com": () => json(fiveWords) },
      query: (q) => (q.table === "meetings" ? { data: [] } : undefined),
    });
    const result = await runCallsJob(h.deps);
    expect(h.rpcs("save_call_transcript")[0].args.p_words).toBe(5);
    expect(h.removeObjects).toHaveBeenCalledWith(["calls/2026/11/m1-gone"]);
    expect(h.queries("storage_deletions").some((q) => q.action === "delete")).toBe(true);
    expect(result.noSpeech).toBe(1);
    // Nothing turned ready, and the end-of-run check finds no ready call.
    expect(h.startRoutine).not.toHaveBeenCalled();
    expect(result.routine).toBe("not started: no call is ready");
  });
  it("leave a no-speech recording to the next drain when removing it could run into the end reserve", async () => {
    const h = harness({
      claims: [transcribeItem("m1")],
      fetch: {
        "api.deepgram.com": () => {
          // The save ends 1 s past the last moment a removal (20 s, then 6 s for its queue row) still fits.
          h.advance(RUN_DEADLINE_MS - END_RESERVE_MS - TIMEOUT_MS.storageWrite - TIMEOUT_MS.db + 1_000);
          return json(fiveWords);
        },
      },
      query: (q) => (q.table === "meetings" ? { data: [] } : undefined),
    });
    const result = await runCallsJob(h.deps);
    expect(result.noSpeech).toBe(1);
    expect(h.removeObjects).not.toHaveBeenCalledWith(["calls/2026/11/m1-gone"]);
    expect(h.queries("storage_deletions").some((q) => q.action === "delete")).toBe(false);
    expect(result.errors).toBe(0);
  });
});

describe("routine starts", () => {
  it("decide once, at the first call that turns ready, and not again at the end", async () => {
    const h = harness({ claims: [transcribeItem("m1"), transcribeItem("m2")] });
    const result = await runCallsJob(h.deps);
    expect(result.transcribed).toBe(2);
    expect(h.startRoutine).toHaveBeenCalledTimes(1);
    expect(h.queries("meetings").filter((q) => q.columns?.includes("phone_calls"))).toHaveLength(1);
    expect(result.routine).toBe("started");
    expect(h.bookkeeping()?.value.routineAttemptAt).toBeTruthy();
  });
  it("records a failed start, so the next runs back off", async () => {
    const h = harness({ claims: [transcribeItem("m1")], startRoutine: async () => "failed" });
    await runCallsJob(h.deps);
    const value = h.bookkeeping()?.value as { routineAttemptAt: string; routineFailureAt: string };
    expect(value.routineFailureAt).toBeTruthy();
    expect(value.routineAttemptAt).toBeTruthy();
    // The next run, a minute later, does not try.
    const next = harness({ start: "2026-11-19T10:05:00Z", prev: value, claims: [transcribeItem("m2")] });
    expect((await runCallsJob(next.deps)).routine).toBe("not started: backing off after a failed start");
    expect(next.startRoutine).not.toHaveBeenCalled();
  });
  it("checks once at the end when nothing turned ready in the run", async () => {
    const h = harness();
    const result = await runCallsJob(h.deps);
    expect(h.startRoutine).toHaveBeenCalledTimes(1);
    expect(result.routine).toBe("started");
  });
});

describe("what leaves the job", () => {
  it("no log line, response or bookkeeping carries a link, a token or a full number", async () => {
    const h = harness({
      fetch: {
        "sandbox.api.callyzer.co": () => json(historyPage),
        "api.deepgram.com": () => json({ err_msg: "Could not fetch http://127.0.0.1:54321/storage/v1/object/sign/x?token=eyJsecret for 9820123456" }, 400),
      },
      claims: [copyItem("c1"), copyItem("c2", { recording_url: "https://cdn.example.com/a/9820123456.mp3" })],
    });
    const result = await runCallsJob(h.deps);
    const stored = [
      ...h.rpcs("finish_call_copy").map((o) => String(o.args.p_error ?? "")),
      ...h.rpcs("finish_call_transcription").map((o) => String(o.args.p_error ?? "")),
    ];
    const texts = [...h.logs.map((l) => l.message), JSON.stringify(result), JSON.stringify(h.bookkeeping()?.value), ...stored];
    expect(stored.length).toBeGreaterThan(0);
    for (const text of texts) {
      const withoutIds = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "");
      expect(withoutIds).not.toMatch(/https?:\/\//);
      expect(withoutIds).not.toContain("token=");
      expect(withoutIds).not.toContain("media1.callyzer.co");
      expect(withoutIds).not.toMatch(/\d{10}/);
    }
  });
});
