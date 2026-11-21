import { afterEach, describe, expect, it, vi } from "vitest";
import { TIMEOUT_MS } from "./budget";
import { DeepgramError, DEEPGRAM_PROVIDER, deepgramListenUrl, parseDeepgramResult, transcribeWithDeepgram } from "./deepgram";
import response from "./fixtures/deepgram-response.json";
import silence from "./fixtures/deepgram-silence.json";
import { DNY_TERMS } from "./vocabulary";

const SIGNED = "https://iaxjxefipmdumfukttvv.supabase.co/storage/v1/object/sign/call-recordings/calls/2026/11/abc-12345678?token=eyJsecret";

type Seen = { url: string; init: RequestInit };

/** A fetch that answers once with `answer` (a Response, or an error to throw) and records the request. */
function fakeFetch(answer: Response | Error) {
  const seen: Seen[] = [];
  const impl: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), init: init ?? {} });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { impl, seen };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function failure(answer: Response | Error): Promise<DeepgramError> {
  const { impl } = fakeFetch(answer);
  const error = await transcribeWithDeepgram(impl, "k", SIGNED, { mipOptOut: true }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(DeepgramError);
  return error as DeepgramError;
}

afterEach(() => vi.restoreAllMocks());

describe("the request", () => {
  it("asks for nova-3, multilingual, diarised, with mip_opt_out and the 30 DNY keyterms in order", async () => {
    const { impl, seen } = fakeFetch(json(response));
    await transcribeWithDeepgram(impl, "k", SIGNED, { mipOptOut: true });
    const url = new URL(seen[0].url);
    expect(`${url.origin}${url.pathname}`).toBe("https://api.deepgram.com/v1/listen");
    const params = [...url.searchParams.entries()];
    expect(params.slice(0, 6)).toEqual([
      ["model", "nova-3"],
      ["language", "multi"],
      ["diarize_model", "latest"],
      ["smart_format", "true"],
      ["punctuate", "true"],
      ["mip_opt_out", "true"],
    ]);
    expect(params.slice(6)).toEqual(DNY_TERMS.map((term) => ["keyterm", term]));
    expect(DNY_TERMS).toHaveLength(30);
  });
  it("leaves mip_opt_out out when the setting is off", () => {
    const url = new URL(deepgramListenUrl({ mipOptOut: false }));
    expect(url.searchParams.has("mip_opt_out")).toBe(false);
    expect(url.searchParams.getAll("keyterm")).toHaveLength(30);
  });
  it("sends the key as a Token header and the signed link as the JSON body, with a 110 s timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { impl, seen } = fakeFetch(json(response));
    await transcribeWithDeepgram(impl, "k", SIGNED, { mipOptOut: true });
    expect(seen[0].init.method).toBe("POST");
    expect(seen[0].init.headers).toEqual({ Authorization: "Token k", "Content-Type": "application/json" });
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ url: SIGNED });
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(110_000);
    expect(TIMEOUT_MS.deepgram).toBe(110_000);
  });
});

describe("the answer", () => {
  it("parses the fixture's words and duration", async () => {
    const { impl } = fakeFetch(json(response));
    const result = await transcribeWithDeepgram(impl, "k", SIGNED, { mipOptOut: true });
    expect(result.durationSec).toBe(147.2);
    expect(result.words).toHaveLength(40);
    expect(result.words[0]).toEqual({ word: "hello", punctuated_word: "Hello", start: 0.8, end: 1.16, speaker: 1 });
  });
  it("reads silence as zero words, and a missing duration as null", () => {
    expect(parseDeepgramResult(silence)).toEqual({ words: [], durationSec: 62 });
    expect(parseDeepgramResult({ results: { channels: [{ alternatives: [{ words: [] }] }] } }).durationSec).toBeNull();
  });
  it("keeps words without a speaker and skips words without a start", () => {
    const parsed = parseDeepgramResult({ results: { channels: [{ alternatives: [{ words: [{ word: "a", start: 1, end: 1.2 }, { word: "b" }, { word: "c", start: 2, end: 2.4, speaker: null }] }] }] } });
    expect(parsed.words).toEqual([
      { word: "a", start: 1, end: 1.2 },
      { word: "c", start: 2, end: 2.4 },
    ]);
  });
  it("names the provider deepgram:nova-3", () => {
    expect(DEEPGRAM_PROVIDER).toBe("deepgram:nova-3");
  });
});

describe("errors", () => {
  it.each([
    [401, "not_billed", "auth"],
    [403, "not_billed", "auth"],
    [402, "not_billed", "credit"],
    [429, "not_billed", "rate"],
    [500, "transient", "server"],
    [503, "transient", "server"],
    [400, "content", "bad_audio"],
    [404, "content", "http"],
    [413, "content", "http"],
  ])("HTTP %i is %s / %s", async (status, outcome, kind) => {
    const error = await failure(json({ err_code: "X", err_msg: "something" }, status));
    expect([error.outcome, error.kind]).toEqual([outcome, kind]);
    expect(error.message).toContain(`HTTP ${status}`);
  });
  it("maps a timeout and a network failure to transient", async () => {
    const timedOut = await failure(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    expect([timedOut.outcome, timedOut.kind]).toEqual(["transient", "timeout"]);
    const network = await failure(new TypeError("fetch failed"));
    expect([network.outcome, network.kind]).toEqual(["transient", "network"]);
  });
  it("maps an answer that is not JSON, or has no words, to content", async () => {
    const notJson = await failure(new Response("<html>oops</html>", { status: 200 }));
    expect([notJson.outcome, notJson.kind]).toEqual(["content", "bad_response"]);
    const noWords = await failure(json({ results: { channels: [] } }));
    expect([noWords.outcome, noWords.kind]).toEqual(["content", "no_words"]);
  });
  it("never carries the signed link, its token or a number in the error text", async () => {
    const error = await failure(json({ err_code: "Bad Request", err_msg: `Failed to retrieve audio from ${SIGNED}; caller 9820123456; token=eyJsecret` }, 400));
    expect(error.message).toContain("[link]");
    expect(error.message).not.toMatch(/https?:\/\//);
    expect(error.message).not.toContain("token=");
    expect(error.message).not.toMatch(/\d{10}/);
    expect(error.message.length).toBeLessThanOrEqual(300);
  });
});
