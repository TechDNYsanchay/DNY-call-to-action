import { describe, expect, it, vi } from "vitest";

// The module is server-only; in tests the marker would throw, so it is replaced with nothing.
vi.mock("server-only", () => ({}));

const { timeoutFetch, timeoutFor } = await import("./db");

const BASE = "https://iaxjxefipmdumfukttvv.supabase.co";

describe("timeoutFor", () => {
  it("gives storage uploads and removals 20 s", () => {
    expect(timeoutFor(`${BASE}/storage/v1/object/call-recordings/calls/2026/11/abc-1234abcd`)).toBe(20_000);
    expect(timeoutFor(`${BASE}/storage/v1/object/call-recordings`)).toBe(20_000);
  });
  it("gives signing a link, RPCs and table reads 6 s", () => {
    expect(timeoutFor(`${BASE}/storage/v1/object/sign/call-recordings/calls/2026/11/abc-1234abcd`)).toBe(6_000);
    expect(timeoutFor(`${BASE}/rest/v1/rpc/claim_call_work`)).toBe(6_000);
    expect(timeoutFor(`${BASE}/rest/v1/sync_state?key=eq.callyzer`)).toBe(6_000);
  });
});

describe("timeoutFetch", () => {
  it("makes exactly one attempt, even on a 503", async () => {
    const base = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const response = await timeoutFetch(() => 6_000, base)(`${BASE}/rest/v1/rpc/claim_call_work`, { method: "POST" });
    expect(response.status).toBe(503);
    expect(base).toHaveBeenCalledTimes(1);
  });
  it("aborts a request that runs past its timeout", async () => {
    const base: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    const started = Date.now();
    const error = await timeoutFetch(() => 50, base)(`${BASE}/rest/v1/rpc/claim_call_work`).catch((e: unknown) => e);
    expect((error as Error).name).toBe("TimeoutError");
    expect(Date.now() - started).toBeLessThan(2_000);
  });
  it("still honours the caller's own signal", async () => {
    const caller = new AbortController();
    const base: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted by caller")), { once: true }));
    const pending = timeoutFetch(() => 60_000, base)(`${BASE}/rest/v1/meetings`, { signal: caller.signal });
    caller.abort();
    await expect(pending).rejects.toThrow("aborted by caller");
  });
});
