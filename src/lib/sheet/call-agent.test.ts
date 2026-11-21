import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUDGET_ALERT_PREFIX, heldText, unsureText } from "@/lib/calls/hold";
import { RELEASE_TEXT, skipReason } from "@/lib/calls/skip";
import type { Json } from "@/lib/supabase/database.types";
import { applyCallClassification, HUMAN_LABEL_SKIP, releaseCall, skipCall } from "./call-agent";
import { CALL_PURGED, CLAIM_GONE } from "./claim";

// The routine's classify, skip and release for a call, against a scripted database. Every query, RPC and
// storage removal is recorded in order, and answered from a small world: the call, its sheets, the hour's
// purges and alerts, what is known about the other party, the clients, and scripted RPC answers (the
// refusals the SQL functions raise). The SQL side of each write is covered by supabase/tests/calls_agent_test.sql.

const scripted = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => scripted.db }));
vi.mock("@/lib/calls/db", () => ({ callsDb: () => scripted.db }));

const ID = "0d4f9b8e-1c2a-4e5f-8a7b-6c5d4e3f2a10";
const CLAIM = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const PATH = `calls/2026/11/788f87f29c369a08e4490c0c165666df-1a2b3c4d`;
// 11:00 IST.
const NOW = new Date("2026-11-21T05:30:00Z");

type Result = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
interface Query {
  table: string;
  action: "select" | "update" | "insert" | "delete";
  columns?: string;
  options?: { count?: string; head?: boolean };
  payload?: Record<string, unknown>;
  filters: unknown[][];
}
type Op = ({ kind: "query" } & Query) | { kind: "rpc"; name: string; args: Record<string, unknown> } | { kind: "remove"; paths: string[] };

interface World {
  /** The meetings row of the call, or null when there is none. */
  call: Record<string, unknown> | null;
  settings: Record<string, Json>;
  sheets: number;
  /** phone_calls.purged_at before the routine's purge. */
  purgedAt: string | null;
  purgesLastHour: number;
  /** An alert from earlier this hour, besides the ones the test itself sends. */
  alertThisHour: boolean;
  heldThisHour: number;
  /** previous_business_call's rows. */
  earlier: Array<{ type: string; client: string | null }>;
  savedName: string | null;
  clients: string[];
  /** Rows a conditional update of the call hits: 0 once the claim went between the read and the write. */
  updated: number;
  updateError: { message: string; code?: string } | null;
  rpc: Record<string, Result>;
}

const CALL = { id: ID, kind: "call", process_status: "processing", claim_token: CLAIM, type: "unknown", type_source: null, process_attempts: 1, client_id: null };

function setup(over: Partial<World> = {}) {
  const world: World = {
    call: { ...CALL },
    settings: { confidence_threshold: 0.8, max_attempts: 3, calls_routine_purges_per_hour: 4 },
    sheets: 0,
    purgedAt: null,
    purgesLastHour: 0,
    alertThisHour: false,
    heldThisHour: 1,
    earlier: [],
    savedName: "Mummy",
    clients: ["Cafe 89", "Saffron Court Hotel"],
    updated: 1,
    updateError: null,
    rpc: {},
    ...over,
  };
  const ops: Op[] = [];
  const queries = (table: string, action: Query["action"]) => ops.filter((o): o is Extract<Op, { kind: "query" }> => o.kind === "query" && o.table === table && o.action === action);
  const inserted = (table: string) => queries(table, "insert").map((q) => q.payload ?? {});
  const alertSent = () => world.alertThisHour || inserted("pipeline_events").some((e) => e.level === "error" && String(e.message).startsWith(BUDGET_ALERT_PREFIX));

  const answer = (q: Query): Result => {
    switch (q.table) {
      case "settings":
        return { data: Object.entries(world.settings).map(([key, value]) => ({ key, value })) };
      case "meetings":
        if (q.action === "update") return world.updateError ? { error: world.updateError } : { data: world.updated ? [{ id: ID }] : [] };
        return q.options?.count ? { count: world.heldThisHour } : { data: world.call };
      case "sheets":
        return { count: world.sheets };
      case "phone_calls":
        return q.options?.count ? { count: world.purgesLastHour } : { data: { purged_at: world.purgedAt } };
      case "pipeline_events":
        return q.action === "select" ? { data: alertSent() ? [{ id: 1 }] : [] } : {};
      case "call_log":
        return { data: { counterpart_name: world.savedName } };
      case "clients": {
        const range = q.filters.find((f) => f[0] === "range") as [string, number, number] | undefined;
        if (range) return { data: world.clients.slice(range[1], range[2] + 1).map((name) => ({ name })), count: world.clients.length };
        return { data: world.clients.map((name, i) => ({ id: `client-${i}`, name })) };
      }
      default:
        return {};
    }
  };
  const from = (table: string) => {
    const q: Query = { table, action: "select", filters: [] };
    const builder: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== "string") return undefined;
          if (prop === "then") {
            return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
              ops.push({ kind: "query", ...q });
              Promise.resolve()
                .then(() => ({ data: null, error: null, count: null, ...answer(q) }))
                .then(resolve, reject);
            };
          }
          return (...args: unknown[]) => {
            if (prop === "update" || prop === "insert" || prop === "delete") {
              q.action = prop;
              q.payload = args[0] as Record<string, unknown>;
            } else if (prop === "select") {
              if (q.action === "select") [q.columns, q.options] = args as [string, Query["options"]];
            } else q.filters.push([prop, ...args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };
  const defaults: Record<string, Result> = {
    previous_business_call: { data: world.earlier },
    purge_claimed_call: { data: PATH },
    hold_call: { data: "needs_decision" },
    mark_call_business: { data: "Call with Rakesh Cafe 89" },
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    ops.push({ kind: "rpc", name, args });
    return { data: null, error: null, ...(world.rpc[name] ?? defaults[name] ?? {}) };
  };
  const storage = {
    from: () => ({
      remove: async (paths: string[]) => {
        ops.push({ kind: "remove", paths });
        return { data: [], error: null };
      },
    }),
  };
  scripted.db = { from, rpc, storage };

  return {
    world,
    ops,
    queries,
    /** The arguments of every call of one RPC. */
    rpcs: (name: string) => ops.flatMap((o) => (o.kind === "rpc" && o.name === name ? [o.args] : [])),
    events: () => inserted("pipeline_events").map((e) => ({ level: e.level, message: e.message })),
    runs: () => inserted("agent_runs").map((r) => ({ kind: r.kind, summary: r.summary })),
    /** RPCs, inserts, updates, deletes and storage removals: anything but a read. */
    writes: () => ops.filter((o) => o.kind !== "query" || o.action !== "select").filter((o) => !(o.kind === "rpc" && o.name === "previous_business_call")),
    /** Where one op sits in the order they ran. */
    indexOf: (match: (o: Op) => boolean) => ops.findIndex(match),
  };
}

const personal = (confidence: number) => ({ type: "personal", confidence, reason: "Personal call", evidence: [], client_name_guess: null, language: "hindi" });
const business = (type: "client" | "vendor", confidence: number, guess: string | null, reason = "Menu costing follow-up with an existing client.") => ({
  type,
  confidence,
  reason,
  evidence: [],
  client_name_guess: guess,
  language: "hinglish",
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a call's classify, skip and release need the routine's current claim", () => {
  it("refuses a missing call or one that is not processing (422), and a missing or replaced claim (409), writing nothing", async () => {
    const cases: Array<[Partial<World>, string | null, number, string]> = [
      [{ call: null }, CLAIM, 422, "Meeting not found"],
      [{ call: { ...CALL, process_status: "ready" } }, CLAIM, 422, "Call is ready, not processing; call next to claim it"],
      [{ call: { ...CALL, process_status: "needs_decision", claim_token: null } }, CLAIM, 422, "Call is needs_decision, not processing; call next to claim it"],
      [{}, null, 409, CLAIM_GONE],
      [{}, "11111111-2222-4333-8444-555555555555", 409, CLAIM_GONE],
    ];
    for (const [world, claim, httpStatus, error] of cases) {
      const t = setup(world);
      expect(await applyCallClassification(ID, personal(0.9), claim)).toEqual({ ok: false, proceed: false, status: null, type: null, confidence: null, errors: [error], httpStatus });
      expect(await skipCall(ID, "personal", claim)).toEqual({ ok: false, status: null, errors: [error], httpStatus });
      expect(await releaseCall(ID, "other", claim)).toEqual({ ok: false, status: null, errors: [error], httpStatus });
      expect(t.writes()).toEqual([]);
    }
  });
});

describe("applyCallClassification", () => {
  it("answers 422 with the schema's errors for an answer that does not fit, writing nothing", async () => {
    const t = setup();
    const outcome = await applyCallClassification(ID, { type: "other", confidence: 2 }, CLAIM);
    expect(outcome).toMatchObject({ ok: false, proceed: false, status: null });
    expect(outcome.errors.length).toBeGreaterThan(0);
    expect(outcome.httpStatus).toBeUndefined();
    expect(t.writes()).toEqual([]);
  });

  it("keeps a person's client or vendor label and goes on to the sheet, noting only what the routine said", async () => {
    const t = setup({ call: { ...CALL, type: "vendor", type_source: "human" } });
    expect(await applyCallClassification(ID, personal(0.9), CLAIM)).toEqual({ ok: true, proceed: true, status: "processing", type: "vendor", confidence: 1, errors: [] });
    expect(t.runs()).toEqual([{ kind: "classify", summary: "Routine said personal (90%); kept the person's label" }]);
    expect(t.ops.filter((o) => o.kind === "rpc")).toEqual([]);
  });

  it("marks a client call business at any confidence, with the matched client and the routine's claim", async () => {
    const t = setup();
    expect(await applyCallClassification(ID, business("client", 0.3, "cafe 89"), CLAIM)).toEqual({ ok: true, proceed: true, status: "processing", type: "client", confidence: 0.3, errors: [] });
    expect(t.rpcs("mark_call_business")).toEqual([
      {
        p_meeting_id: ID,
        p_type: "client",
        p_source: "llm",
        p_confidence: 0.3,
        p_reason: "Menu costing follow-up with an existing client.",
        p_client_id: "client-0",
        p_client_name_guess: "cafe 89",
        p_claim: CLAIM,
      },
    ]);
    expect(t.runs()).toEqual([{ kind: "classify", summary: "Classified as a client call (30%)" }]);
    expect(t.events()).toEqual([{ level: "info", message: "Classified as a client call (30%)" }]);
  });

  it("gives a vendor call no client, and keeps numbers out of the guess and the reason", async () => {
    const t = setup();
    const answer = business("vendor", 0.95, "Sharma Traders 98201 23456", "Linen supplier on 9820123456 confirming the next delivery.");
    expect(await applyCallClassification(ID, answer, CLAIM)).toMatchObject({ ok: true, proceed: true, type: "vendor" });
    const [args] = t.rpcs("mark_call_business");
    expect(args).toMatchObject({ p_type: "vendor", p_client_id: null, p_client_name_guess: "Sharma Traders", p_claim: CLAIM });
    expect(String(args.p_reason)).not.toMatch(/\d{10}/);
    // A vendor is never looked up among the clients.
    expect(t.queries("clients", "select")).toEqual([]);
  });

  it("answers mark_call_business's refusals: the claim or the call gone, or a person's label in between", async () => {
    for (const [message, httpStatus, error] of [
      ["claim_mismatch", 409, CLAIM_GONE],
      ["call_purged", 409, CALL_PURGED],
      ["call_not_found", 422, "Meeting not found"],
    ] as const) {
      setup({ rpc: { mark_call_business: { error: { message, code: "P0001" } } } });
      expect(await applyCallClassification(ID, business("client", 0.9, null), CLAIM)).toEqual({ ok: false, proceed: false, status: null, type: null, confidence: null, errors: [error], httpStatus });
    }
    const labelled = setup({ rpc: { mark_call_business: { error: { message: "human_label", code: "P0001" } } } });
    expect(await applyCallClassification(ID, business("client", 0.9, null), CLAIM)).toMatchObject({ ok: true, proceed: true, status: "processing" });
    expect(labelled.runs()).toEqual([]);
    setup({ rpc: { mark_call_business: { error: { message: "deadlock detected", code: "40P01" } } } });
    await expect(applyCallClassification(ID, business("client", 0.9, null), CLAIM)).rejects.toThrow("mark_call_business: 40P01 deadlock detected");
  });

  it("keeps a re-run's sheet whatever the not-work answer, while the claim holds", async () => {
    for (const confidence of [0.95, 0.5]) {
      const t = setup({ sheets: 1 });
      expect(await applyCallClassification(ID, personal(confidence), CLAIM)).toEqual({ ok: true, proceed: false, status: "done", type: "unknown", confidence: null, errors: [], kept: true });
      const [update] = t.queries("meetings", "update");
      expect(update.payload).toEqual({ process_status: "done", claimed_at: null, claim_token: null, failure_reason: null });
      expect(update.filters).toEqual(expect.arrayContaining([["eq", "id", ID], ["eq", "kind", "call"], ["eq", "process_status", "processing"], ["eq", "claim_token", CLAIM]]));
      expect(t.runs()).toEqual([{ kind: "classify", summary: "Routine said not a work call on a re-run; the sheet was kept" }]);
      expect(t.ops.filter((o) => o.kind === "rpc")).toEqual([]);
    }
    setup({ sheets: 1, updated: 0 });
    expect(await applyCallClassification(ID, personal(0.95), CLAIM)).toMatchObject({ ok: false, errors: [CLAIM_GONE], httpStatus: 409 });
  });

  it("hands an unsure answer to a person, who has until a stated time to decide", async () => {
    const t = setup();
    expect(await applyCallClassification(ID, personal(0.6), CLAIM)).toEqual({ ok: true, proceed: false, status: "needs_decision", type: "personal", confidence: 0.6, errors: [], held: false });
    expect(t.rpcs("hold_call")).toEqual([{ p_meeting_id: ID, p_claim: CLAIM, p_kind: "unsure", p_reason: unsureText(0.6, 24, NOW), p_confidence: 0.6 }]);
    expect(t.rpcs("hold_call")[0].p_reason).toContain("deleted at 11:00, 22 Nov unless someone decides");
    expect(t.events()).toEqual([{ level: "info", message: "Routine was not sure a call is a work call; a person decides" }]);
    // The purge budget is for sure answers: it is not even read.
    expect(t.queries("phone_calls", "select")).toEqual([]);
  });

  it("holds an unsure answer without a time limit when the number or the saved name is known business", async () => {
    const number = setup({ earlier: [{ type: "client", client: "Cafe 89" }] });
    expect(await applyCallClassification(ID, personal(0.6), CLAIM)).toMatchObject({ ok: true, proceed: false, status: "needs_decision", held: true });
    expect(number.rpcs("hold_call")).toEqual([{ p_meeting_id: ID, p_claim: CLAIM, p_kind: "held", p_reason: heldText("known_number"), p_confidence: 0.6 }]);
    expect(number.rpcs("previous_business_call")).toEqual([{ p_meeting_id: ID }]);

    const name = setup({ savedName: "Rakesh Cafe 89" });
    expect(await applyCallClassification(ID, personal(0.5), CLAIM)).toMatchObject({ status: "needs_decision", held: true });
    expect(name.rpcs("hold_call")[0]).toMatchObject({ p_kind: "held", p_reason: heldText("known_name") });
    expect(name.events()).toEqual([{ level: "info", message: "Routine's not-work answer was held for a person (known_name)" }]);
  });

  it("deletes the call for a sure not-work answer when nothing looks risky, logging nothing before the purge", async () => {
    const t = setup();
    expect(await applyCallClassification(ID, personal(0.9), CLAIM)).toEqual({ ok: true, proceed: false, status: "skipped", type: "personal", confidence: 0.9, errors: [] });
    expect(t.rpcs("purge_claimed_call")).toEqual([
      { p_meeting_id: ID, p_code: "personal", p_reason: skipReason("personal"), p_summary: "Classified as personal (90%) by the routine", p_claim: CLAIM },
    ]);
    expect(t.ops.filter((o) => o.kind === "remove")).toEqual([{ kind: "remove", paths: [PATH] }]);
    expect(t.queries("storage_deletions", "delete")[0].filters).toEqual([["eq", "path", PATH]]);
    // purge_claimed_call leaves its own fixed agent_runs row; the routine's words are never stored.
    expect(t.runs()).toEqual([]);
    expect(t.events()).toEqual([{ level: "info", message: "Routine marked a call not a work call (personal)" }]);
    const purgedAt = t.indexOf((o) => o.kind === "rpc" && o.name === "purge_claimed_call");
    expect(t.indexOf((o) => o.kind === "query" && o.action === "insert")).toBeGreaterThan(purgedAt);
  });

  it("holds a sure answer for a known number, a client's name anywhere in the client list, or a spent budget", async () => {
    const number = setup({ earlier: [{ type: "vendor", client: null }] });
    expect(await applyCallClassification(ID, personal(0.95), CLAIM)).toMatchObject({ status: "needs_decision", held: true });
    expect(number.rpcs("hold_call")[0]).toMatchObject({ p_kind: "held", p_reason: heldText("known_number"), p_confidence: 0.95 });
    expect(number.rpcs("purge_claimed_call")).toEqual([]);

    // Past the 500 names the package lists, and past the first page the API returns.
    const clients = Array.from({ length: 1_500 }, (_, i) => `Client ${String(i).padStart(4, "0")}`);
    clients[1_400] = "Cafe 89";
    const name = setup({ savedName: "Rakesh Cafe 89", clients });
    expect(await applyCallClassification(ID, personal(0.95), CLAIM)).toMatchObject({ status: "needs_decision", held: true });
    expect(name.rpcs("hold_call")[0]).toMatchObject({ p_kind: "held", p_reason: heldText("known_name") });
    expect(name.queries("clients", "select").map((q) => q.filters.find((f) => f[0] === "range"))).toEqual([
      ["range", 0, 999],
      ["range", 1_000, 1_999],
    ]);

    const budget = setup({ purgesLastHour: 4 });
    expect(await applyCallClassification(ID, personal(0.95), CLAIM)).toMatchObject({ status: "needs_decision", held: true });
    expect(budget.rpcs("hold_call")[0]).toMatchObject({ p_kind: "held", p_reason: heldText("budget") });
    expect(budget.rpcs("purge_claimed_call")).toEqual([]);
  });

  it("sends the purge budget's alert once an hour", async () => {
    const t = setup({ purgesLastHour: 4, heldThisHour: 2 });
    await applyCallClassification(ID, personal(0.95), CLAIM);
    await applyCallClassification(ID, personal(0.95), CLAIM);
    expect(t.rpcs("hold_call")).toHaveLength(2);
    expect(t.events().filter((e) => e.level === "error")).toEqual([{ level: "error", message: "Routine purges paused for an hour: 2 calls held for a person" }]);

    const earlier = setup({ purgesLastHour: 4, alertThisHour: true });
    await applyCallClassification(ID, personal(0.95), CLAIM);
    expect(earlier.events().filter((e) => e.level === "error")).toEqual([]);
  });

  it("answers the purge's refusals, and deletes nothing twice", async () => {
    // A sheet saved between the count and the purge: kept.
    const sheet = setup({ rpc: { purge_claimed_call: { error: { message: "has_sheet", code: "P0001" } } } });
    expect(await applyCallClassification(ID, personal(0.9), CLAIM)).toMatchObject({ ok: true, proceed: false, status: "done", kept: true });
    expect(sheet.queries("meetings", "update")).toHaveLength(1);
    for (const [message, httpStatus, error] of [
      ["claim_mismatch", 409, CLAIM_GONE],
      ["call_not_found", 422, "Meeting not found"],
    ] as const) {
      setup({ rpc: { purge_claimed_call: { error: { message, code: "P0001" } } } });
      expect(await applyCallClassification(ID, personal(0.9), CLAIM)).toMatchObject({ ok: false, errors: [error], httpStatus });
    }
    // A person said client or vendor in between: their label stands and the routine writes the sheet.
    setup({ rpc: { purge_claimed_call: { error: { message: "human_label", code: "P0001" } } } });
    expect(await applyCallClassification(ID, personal(0.9), CLAIM)).toMatchObject({ ok: true, proceed: true, status: "processing" });
    // A person deleted it first.
    const gone = setup({ purgedAt: "2026-11-21T05:29:00Z" });
    expect(await applyCallClassification(ID, personal(0.9), CLAIM)).toMatchObject({ ok: false, errors: [CALL_PURGED], httpStatus: 409 });
    expect(gone.rpcs("purge_claimed_call")).toEqual([]);
    setup({ rpc: { purge_claimed_call: { error: { message: "canceling statement due to statement timeout", code: "57014" } } } });
    await expect(applyCallClassification(ID, personal(0.9), CLAIM)).rejects.toThrow("purge_call failed: 57014 canceling statement");
  });

  it("answers hold_call's refusals", async () => {
    setup({ rpc: { hold_call: { error: { message: "claim_mismatch", code: "P0001" } } } });
    expect(await applyCallClassification(ID, personal(0.6), CLAIM)).toMatchObject({ ok: false, errors: [CLAIM_GONE], httpStatus: 409 });
    setup({ rpc: { hold_call: { error: { message: "human_label", code: "P0001" } } } });
    expect(await applyCallClassification(ID, personal(0.6), CLAIM)).toMatchObject({ ok: true, proceed: true, status: "processing" });
    setup({ rpc: { hold_call: { error: { message: "unknown hold kind x", code: "P0001" } } } });
    await expect(applyCallClassification(ID, personal(0.6), CLAIM)).rejects.toThrow("hold_call: P0001 unknown hold kind x");
  });
});

describe("skipCall", () => {
  it("never deletes a call a person marked client or vendor: 409, the claim kept, a warning logged", async () => {
    const t = setup({ call: { ...CALL, type: "client", type_source: "human" } });
    expect(await skipCall(ID, "personal", CLAIM)).toEqual({ ok: false, status: null, errors: [HUMAN_LABEL_SKIP], httpStatus: 409 });
    expect(t.events()).toEqual([{ level: "warn", message: "Routine tried to skip a call a person marked as business" }]);
    expect(t.ops.filter((o) => o.kind === "rpc" || (o.kind === "query" && o.action === "update"))).toEqual([]);
  });

  it("keeps a re-run's sheet", async () => {
    const t = setup({ sheets: 2 });
    expect(await skipCall(ID, "no_content", CLAIM)).toEqual({ ok: true, status: "done", errors: [], kept: true });
    expect(t.runs()).toEqual([{ kind: "skip", summary: "Routine said not a work call on a re-run; the sheet was kept" }]);
    expect(t.rpcs("purge_claimed_call")).toEqual([]);
  });

  it("deletes the call with fixed text only", async () => {
    const t = setup();
    expect(await skipCall(ID, "not_business", CLAIM)).toEqual({ ok: true, status: "skipped", errors: [] });
    expect(t.rpcs("purge_claimed_call")).toEqual([
      { p_meeting_id: ID, p_code: "not_business", p_reason: "Not a work call. The recording and transcript were deleted.", p_summary: "Skipped as not_business by the routine", p_claim: CLAIM },
    ]);
    expect(t.events()).toEqual([{ level: "info", message: "Routine marked a call not a work call (not_business)" }]);
  });

  it("goes through the same holds as a sure classify", async () => {
    const number = setup({ earlier: [{ type: "client", client: "Cafe 89" }] });
    expect(await skipCall(ID, "personal", CLAIM)).toEqual({ ok: true, status: "needs_decision", errors: [], held: true });
    expect(number.rpcs("hold_call")).toEqual([{ p_meeting_id: ID, p_claim: CLAIM, p_kind: "held", p_reason: heldText("known_number"), p_confidence: 1 }]);
    const budget = setup({ purgesLastHour: 9 });
    expect(await skipCall(ID, "personal", CLAIM)).toMatchObject({ status: "needs_decision", held: true });
    expect(budget.rpcs("hold_call")[0]).toMatchObject({ p_reason: heldText("budget") });
    expect(budget.events().filter((e) => e.level === "error")).toHaveLength(1);
  });
});

describe("releaseCall", () => {
  it("gives the call back to the queue, written only under the current claim", async () => {
    const t = setup();
    expect(await releaseCall(ID, "sheet_checks", CLAIM)).toEqual({ ok: true, status: "ready", errors: [] });
    const [update] = t.queries("meetings", "update");
    expect(update.payload).toEqual({ process_status: "ready", claimed_at: null, claim_token: null });
    expect(update.filters).toEqual(expect.arrayContaining([["eq", "id", ID], ["eq", "kind", "call"], ["eq", "process_status", "processing"], ["eq", "claim_token", CLAIM]]));
    expect(t.runs()).toEqual([{ kind: "release", summary: RELEASE_TEXT.sheet_checks }]);
    expect(t.events()).toEqual([{ level: "warn", message: "Routine released a call (sheet_checks)" }]);
  });

  it("fails the call once its attempts are used up, with fixed text", async () => {
    const t = setup({ call: { ...CALL, process_attempts: 3 } });
    expect(await releaseCall(ID, "empty_transcript", CLAIM)).toEqual({ ok: true, status: "failed", errors: [] });
    expect(t.queries("meetings", "update")[0].payload).toEqual({
      process_status: "failed",
      claimed_at: null,
      claim_token: null,
      failure_reason: "The routine gave up after 3 attempts: The transcript was empty",
    });
    expect(t.runs()).toEqual([{ kind: "fail", summary: RELEASE_TEXT.empty_transcript }]);
    expect(t.events()).toEqual([{ level: "error", message: "Routine gave up on a call after 3 attempts (empty_transcript)" }]);
  });

  it("answers 409 when the claim went between the read and the write, and 422 for a database error", async () => {
    const gone = setup({ updated: 0 });
    expect(await releaseCall(ID, "other", CLAIM)).toEqual({ ok: false, status: null, errors: [CLAIM_GONE], httpStatus: 409 });
    expect(gone.runs()).toEqual([]);
    setup({ updateError: { message: "canceling statement due to statement timeout", code: "57014" } });
    expect(await releaseCall(ID, "other", CLAIM)).toEqual({ ok: false, status: null, errors: ["57014 canceling statement due to statement timeout"] });
  });
});
