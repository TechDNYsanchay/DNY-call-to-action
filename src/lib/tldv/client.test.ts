import { describe, expect, it, vi } from "vitest";
import meetingFixture from "./fixtures/meeting.json";
import transcriptFixture from "./fixtures/transcript.json";

// The real module is server-only; in tests the marker would throw, so it is replaced with nothing.
vi.mock("server-only", () => ({}));

const { backoffMs, createTldvClient, TldvError, TLDV_USER_AGENT } = await import("./client");

type Call = { url: string; headers: Record<string, string> };

/** A fetch that answers from a queue of responses and records what it was asked. */
function fakeFetch(responses: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Call[] = [];
  const impl: typeof fetch = async (input, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ url: String(input), headers });
    const next = responses.shift();
    if (!next) throw new Error("fakeFetch: no response queued");
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

const client = (responses: Array<{ status: number; body?: unknown } | Error>) => {
  const f = fakeFetch(responses);
  const sleeps: number[] = [];
  const c = createTldvClient({ apiKey: "test-key", baseUrl: "https://pasta.test/v1alpha1", fetchImpl: f.impl, sleep: async (ms) => void sleeps.push(ms), timeoutMs: 1000 });
  return { c, calls: f.calls, sleeps };
};

describe("headers and urls", () => {
  it("sends the api key and the custom user agent to the right path", async () => {
    const { c, calls } = client([{ status: 200, body: meetingFixture }]);
    const meeting = await c.getMeeting(meetingFixture.id);
    expect(meeting?.id).toBe(meetingFixture.id);
    expect(meeting?.title).toBe("Hotel Sunrise Udaipur - weekly ops review");
    expect(meeting?.raw).toEqual(meetingFixture);
    expect(calls[0].url).toBe(`https://pasta.test/v1alpha1/meetings/${meetingFixture.id}`);
    expect(calls[0].headers["x-api-key"]).toBe("test-key");
    expect(calls[0].headers["user-agent"]).toBe(TLDV_USER_AGENT);
  });
  it("passes list parameters and caps limit at 100", async () => {
    const { c, calls } = client([{ status: 200, body: { page: 1, pages: 1, total: 1, results: [meetingFixture] } }]);
    const page = await c.listMeetings({ from: "2026-11-01T00:00:00Z", to: "2026-11-04T00:00:00Z", limit: 500 });
    expect(page.results).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v1alpha1/meetings");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("from")).toBe("2026-11-01T00:00:00Z");
    expect(url.searchParams.get("page")).toBe("1");
  });
});

describe("retries", () => {
  it("retries twice on 429 and 5xx with growing backoff, then succeeds", async () => {
    const { c, calls, sleeps } = client([{ status: 429, body: { message: "slow down" } }, { status: 503 }, { status: 200, body: meetingFixture }]);
    const meeting = await c.getMeeting(meetingFixture.id);
    expect(meeting?.id).toBe(meetingFixture.id);
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
  });
  it("gives up after the third failure with a typed error", async () => {
    const { c, calls } = client([{ status: 500 }, { status: 500 }, { status: 502, body: { message: "bad gateway" } }]);
    const error = await c.getMeeting("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TldvError);
    expect((error as InstanceType<typeof TldvError>).status).toBe(502);
    expect(calls).toHaveLength(3);
  });
  it("retries network failures too", async () => {
    const { c } = client([new Error("socket hang up"), { status: 200, body: meetingFixture }]);
    expect((await c.getMeeting("x"))?.id).toBe(meetingFixture.id);
  });
  it("does not retry a 400", async () => {
    const { c, calls } = client([{ status: 400, body: { message: "bad id" } }]);
    await expect(c.getMeeting("bad")).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
  });
  it("backoff grows and carries jitter", () => {
    expect(backoffMs(0, () => 0)).toBe(500);
    expect(backoffMs(1, () => 0)).toBe(1500);
    expect(backoffMs(1, () => 1)).toBe(1950);
  });
});

describe("meetings", () => {
  it("returns null for an unknown meeting (404)", async () => {
    const { c } = client([{ status: 404, body: { name: "NotFound", message: "no" } }]);
    expect(await c.getMeeting("missing")).toBeNull();
  });
  it("surfaces 403 on a meeting as an error (organiser's plan)", async () => {
    const { c } = client([{ status: 403, body: { message: "forbidden" } }]);
    await expect(c.getMeeting("locked")).rejects.toMatchObject({ status: 403 });
  });
  it("surfaces 401 as a configuration error", async () => {
    const { c } = client([{ status: 401, body: { message: "invalid api key" } }]);
    const error = (await c.getMeeting("x").catch((e: unknown) => e)) as InstanceType<typeof TldvError>;
    expect(error.status).toBe(401);
    expect(error.isConfiguration).toBe(true);
  });
  it("walks every page and de-duplicates", async () => {
    const other = { ...meetingFixture, id: "second" };
    const { c, calls } = client([
      { status: 200, body: { page: 1, pages: 2, total: 3, results: [meetingFixture, other] } },
      { status: 200, body: { page: 2, pages: 2, total: 3, results: [other, { id: "no-date" }] } },
    ]);
    const all = await c.listMeetingsSince("2026-11-01T00:00:00Z", { to: "2026-11-04T00:00:00Z" });
    expect(all.map((m) => m.id)).toEqual([meetingFixture.id, "second"]);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1].url).searchParams.get("page")).toBe("2");
  });
  it("stops at maxPages", async () => {
    const page = (n: number) => ({ status: 200, body: { page: n, pages: 10, total: 1000, results: [{ ...meetingFixture, id: `m${n}` }] } });
    const { c, calls } = client([page(1), page(2), page(3)]);
    const all = await c.listMeetingsSince("2026-11-01T00:00:00Z", { maxPages: 2, to: "2026-11-04T00:00:00Z" });
    expect(all).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });
});

describe("transcripts", () => {
  it("returns merged turns and the raw sentence count when complete", async () => {
    const { c } = client([{ status: 200, body: transcriptFixture }]);
    const t = await c.getTranscript(meetingFixture.id);
    expect(t?.transcriptId).toBe(transcriptFixture.id);
    expect(t?.sentenceCount).toBe(45);
    expect(t?.turns.length).toBeGreaterThan(10);
    expect(t?.turns.length).toBeLessThan(45);
    expect(t?.turns[0]).toMatchObject({ speaker: "Priya Nair", startSec: 4 });
  });
  it("treats 404, 403 and an empty list as not ready", async () => {
    for (const response of [{ status: 404 }, { status: 403 }, { status: 200, body: { id: "t", meetingId: "m", data: [] } }]) {
      const { c } = client([response]);
      expect(await c.getTranscript("m")).toBeNull();
    }
  });
  it("still surfaces 401 as a configuration error", async () => {
    const { c } = client([{ status: 401 }]);
    await expect(c.getTranscript("m")).rejects.toMatchObject({ status: 401 });
  });
  it("reads the older { transcript, segments } webhook-era shape", async () => {
    const { c } = client([{ status: 200, body: { id: "t", meetingId: "m", segments: [{ startTime: 1, endTime: 2, text: "Hello there." }] } }]);
    const t = await c.getTranscript("m");
    expect(t?.turns[0]).toMatchObject({ speaker: "Unknown speaker", text: "Hello there." });
    expect(t?.sentenceCount).toBe(1);
  });
});

describe("notes", () => {
  it("returns null when there are no notes yet", async () => {
    const { c } = client([{ status: 200, body: { markdownContent: "", structuredNotes: [], topics: [] } }]);
    expect(await c.getNotes("m")).toBeNull();
  });
  it("returns the notes when present", async () => {
    const { c } = client([{ status: 200, body: { markdownContent: "# Notes", structuredNotes: [{ text: "a" }], topics: [] } }]);
    expect(await c.getNotes("m")).toEqual({ markdownContent: "# Notes", structuredNotes: [{ text: "a" }], topics: [] });
  });
});

describe("timeouts", () => {
  it("aborts a hanging request and reports a timeout", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
      });
    const c = createTldvClient({ apiKey: "k", baseUrl: "https://pasta.test/v1alpha1", fetchImpl: hanging, sleep: async () => undefined, timeoutMs: 5, retries: 0 });
    const error = (await c.getMeeting("m").catch((e: unknown) => e)) as InstanceType<typeof TldvError>;
    expect(error).toBeInstanceOf(TldvError);
    expect(error.status).toBe(0);
    expect(error.message).toContain("no answer within");
  });
});
