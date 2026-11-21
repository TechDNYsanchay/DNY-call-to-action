import { describe, expect, it } from "vitest";
import { type CallsDeps, newRunState, parseCallyzerState } from "@/lib/calls/deps";
import { DEFAULT_CALLS_SETTINGS } from "@/lib/calls/settings";
import type { DayWindow } from "@/lib/calls/types";
import { CALLYZER_HISTORY_PATH, CallyzerError, createPacer, fetchCallHistory, MAX_REQUESTS_PER_RUN, PollStop } from "./client";

const KEY = "cz-test-key-123";
const BASE = "https://sandbox.api.callyzer.co";
const TODAY: DayWindow = { from: "2026-11-19", to: "2026-11-19", rereadDay: null };

type Answer = { status: number; body?: string; headers?: Record<string, string> } | Error;
type Seen = { url: string; init: RequestInit; at: number };

/** Scripted deps: a clock that only moves when the code sleeps, and a fetch that answers from a queue. */
function harness(startIso: string, answers: Answer[]) {
  let t = Date.parse(startIso);
  const seen: Seen[] = [];
  const logs: string[] = [];
  const deps = {
    now: () => new Date(t),
    sleep: async (ms: number) => void (t += ms),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), init: init ?? {}, at: t });
      const next = answers.shift();
      if (!next) throw new Error("no answer queued");
      if (next instanceof Error) throw next;
      return new Response(next.body ?? null, { status: next.status, headers: next.headers });
    }) as typeof fetch,
    log: async (_level: string, _step: string, message: string) => void logs.push(message),
  } as unknown as CallsDeps;
  const run = newRunState(deps, DEFAULT_CALLS_SETTINGS, parseCallyzerState(null));
  const pacer = createPacer(deps, run.startedAt);
  const fetchWindow = (w: DayWindow = TODAY, base = BASE) => fetchCallHistory(deps, { base, key: KEY }, w, pacer, run);
  return { deps, run, seen, logs, fetchWindow, clock: () => new Date(t).toISOString() };
}

const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ uniqueId: `call-${from + i}` }));
const page = (n: number, from: number, total?: number) => ({ status: 200, body: JSON.stringify({ data: rows(n, from), message: "Success", ...(total !== undefined ? { recordsTotal: total } : {}) }) });

async function failure(answers: Answer[]): Promise<CallyzerError> {
  const { fetchWindow } = harness("2026-11-19T10:04:00Z", answers);
  const error = await fetchWindow().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CallyzerError);
  const message = (error as Error).message;
  expect(message).not.toContain(KEY);
  for (const answer of answers) if (!(answer instanceof Error) && answer.body) expect(message).not.toContain(answer.body.slice(0, 20));
  return error as CallyzerError;
}

describe("the request", () => {
  it("posts the all-string body with the bearer key to the call-history path", async () => {
    const { fetchWindow, seen } = harness("2026-11-19T10:04:00Z", [page(3, 0, 3)]);
    expect(await fetchWindow()).toHaveLength(3);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`${BASE}${CALLYZER_HISTORY_PATH}`);
    expect(seen[0].init.method).toBe("POST");
    expect(seen[0].init.headers).toEqual({ Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
    expect(seen[0].init.redirect).toBe("error");
    expect(JSON.parse(String(seen[0].init.body))).toEqual({
      callStartDate: "2026-11-19",
      callEndDate: "2026-11-19",
      callTypes: "Incoming,Outgoing",
      recordFrom: "0",
      pageSize: "100",
    });
  });
  it("accepts the base with a trailing slash and the production host", async () => {
    const a = harness("2026-11-19T10:04:00Z", [page(0, 0, 0)]);
    await a.fetchWindow(TODAY, "https://sandbox.api.callyzer.co/");
    expect(a.seen[0].url).toBe(`${BASE}${CALLYZER_HISTORY_PATH}`);
    const b = harness("2026-11-19T10:04:00Z", [page(0, 0, 0)]);
    await b.fetchWindow(TODAY, "https://api1.callyzer.co");
    expect(b.seen[0].url).toBe(`https://api1.callyzer.co${CALLYZER_HISTORY_PATH}`);
  });
  it("refuses a base that is not an allowed Callyzer host, before any request", async () => {
    for (const base of ["https://evil.example.com", "http://sandbox.api.callyzer.co", "https://sandbox.api.callyzer.co/admin", "https://sandbox.api.callyzer.co:8443", "https://sandbox.api.callyzer.co.evil.com", "not a url"]) {
      const { fetchWindow, seen } = harness("2026-11-19T10:04:00Z", []);
      const error = await fetchWindow(TODAY, base).catch((e: unknown) => e);
      expect((error as CallyzerError).kind).toBe("host");
      expect(seen).toHaveLength(0);
    }
  });
});

describe("paging", () => {
  it("reads 230 rows in 3 requests (recordFrom 0, 100, 200), at least 2.5 s apart", async () => {
    const { fetchWindow, seen, run } = harness("2026-11-19T10:04:00Z", [page(100, 0, 230), page(100, 100, 230), page(30, 200, 230)]);
    expect(await fetchWindow()).toHaveLength(230);
    expect(seen.map((s) => JSON.parse(String(s.init.body)).recordFrom)).toEqual(["0", "100", "200"]);
    expect(seen[1].at - seen[0].at).toBeGreaterThanOrEqual(2_500);
    expect(seen[2].at - seen[1].at).toBeGreaterThanOrEqual(2_500);
    expect(run.counts.callyzerRequests).toBe(3);
  });
  it("stops when the total is reached, without asking for an empty page", async () => {
    const { fetchWindow, seen } = harness("2026-11-19T10:04:00Z", [page(100, 0, 200), page(100, 100, 200)]);
    expect(await fetchWindow()).toHaveLength(200);
    expect(seen).toHaveLength(2);
  });
  it("keeps paging without recordsTotal until a short page", async () => {
    const { fetchWindow, seen } = harness("2026-11-19T10:04:00Z", [page(100, 0), page(100, 100), page(7, 200)]);
    expect(await fetchWindow()).toHaveLength(207);
    expect(seen).toHaveLength(3);
  });
  it("sends at most 6 requests in a run", async () => {
    const answers = Array.from({ length: 10 }, (_, i) => page(100, i * 100));
    const { fetchWindow, seen } = harness("2026-11-19T10:04:00Z", answers);
    const error = await fetchWindow().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PollStop);
    expect((error as PollStop).reason).toBe("budget");
    expect(seen).toHaveLength(MAX_REQUESTS_PER_RUN);
  });
});

describe("rate limits", () => {
  it("retries a 429 once after Retry-After", async () => {
    const { fetchWindow, seen } = harness("2026-11-19T10:04:00Z", [{ status: 429, headers: { "retry-after": "3" } }, page(2, 0, 2)]);
    expect(await fetchWindow()).toHaveLength(2);
    expect(seen).toHaveLength(2);
    expect(seen[1].at - seen[0].at).toBe(3_000);
  });
  it("waits at least 2.5 s even when Retry-After says less", async () => {
    const { fetchWindow, seen } = harness("2026-11-19T10:04:00Z", [{ status: 429, headers: { "retry-after": "1" } }, page(1, 0, 1)]);
    await fetchWindow();
    expect(seen[1].at - seen[0].at).toBe(2_500);
  });
  it("gives up as rate after a second 429, or when Retry-After is over 10 s", async () => {
    expect((await failure([{ status: 429, headers: { "retry-after": "3" } }, { status: 429, headers: { "retry-after": "3" } }])).kind).toBe("rate");
    expect((await failure([{ status: 429, headers: { "retry-after": "30" } }])).kind).toBe("rate");
  });
});

describe("errors", () => {
  it.each([
    [401, "auth"],
    [403, "add_on"],
    [400, "bad_request"],
    [404, "bad_request"],
    [500, "network"],
    [502, "network"],
  ] as const)("HTTP %i is %s", async (status, kind) => {
    expect((await failure([{ status, body: `{"message":"secret detail ${KEY}"}` }])).kind).toBe(kind);
  });
  it("calls an empty 200 empty, and HTML or a non-envelope bad_response", async () => {
    expect((await failure([{ status: 200, body: "" }])).kind).toBe("empty");
    expect((await failure([{ status: 200, body: "   \n" }])).kind).toBe("empty");
    expect((await failure([{ status: 200, body: "<html><body>Maintenance for 9820123456</body></html>" }])).kind).toBe("bad_response");
    expect((await failure([{ status: 200, body: "[1,2,3]" }])).kind).toBe("bad_response");
  });
  it("calls a timeout or a network failure network", async () => {
    expect((await failure([new DOMException("The operation was aborted due to timeout", "TimeoutError")])).kind).toBe("network");
    expect((await failure([new TypeError("fetch failed")])).kind).toBe("network");
  });
});

describe("Sales QA's quiet windows", () => {
  it("sends nothing at 10:15:10Z: the wait would be over 35 s", async () => {
    const { fetchWindow, seen } = harness("2026-11-19T10:15:10Z", [page(1, 0, 1)]);
    const error = await fetchWindow().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PollStop);
    expect((error as PollStop).reason).toBe("quiet");
    expect(seen).toHaveLength(0);
  });
  it("at 10:16:05Z waits until 10:16:30Z, then sends", async () => {
    const { fetchWindow, seen } = harness("2026-11-19T10:16:05Z", [page(1, 0, 1)]);
    expect(await fetchWindow()).toHaveLength(1);
    expect(new Date(seen[0].at).toISOString()).toBe("2026-11-19T10:16:30.000Z");
  });
  it("never polls in a run that starts at :00 or :30", async () => {
    for (const at of ["2026-11-19T10:00:02Z", "2026-11-19T10:30:01Z"]) {
      const { fetchWindow, seen } = harness(at, [page(1, 0, 1)]);
      expect(await fetchWindow().catch((e: unknown) => e)).toBeInstanceOf(PollStop);
      expect(seen).toHaveLength(0);
    }
  });
  it("does not start a later page inside a quiet window", async () => {
    // The first page goes at 10:14:48; the next would start at 10:14:50.5, inside the window that opens at
    // 10:14:50, and the wait from there (100 s) is too long.
    const { fetchWindow, seen } = harness("2026-11-19T10:14:48Z", [page(100, 0, 150), page(50, 100, 150)]);
    const error = await fetchWindow().catch((e: unknown) => e);
    expect((error as PollStop).reason).toBe("quiet");
    expect(seen).toHaveLength(1);
  });
});
