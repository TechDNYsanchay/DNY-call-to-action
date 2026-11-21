import { describe, expect, it } from "vitest";
import { checkRecordingUrl, downloadRecording, isStubRecording, MAX_RECORDING_BYTES, sniffAudio, storagePathPrefix } from "./media";

const bytes = (...parts: Array<string | number[]>): Uint8Array =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)).concat(new Array(16).fill(0)));

describe("isStubRecording", () => {
  it("uses the format's floor per second of the call", () => {
    expect(isStubRecording(10_000, 60, "mp3")).toBe(true);
    expect(isStubRecording(90_000, 60, "mp3")).toBe(false);
    expect(isStubRecording(89_999, 60, "mp3")).toBe(true);
    expect(isStubRecording(15_000, 60, "amr")).toBe(true);
    expect(isStubRecording(18_000, 60, "amr")).toBe(false);
  });
  it("calls any file under 4 KB a stub", () => {
    for (const format of ["mp3", "m4a", "wav", "ogg", "amr", "3gp"] as const) expect(isStubRecording(4_000, 1, format)).toBe(true);
  });
});

describe("sniffAudio", () => {
  it("recognises each format by its first bytes", () => {
    expect(sniffAudio(bytes("ID3", [4, 0]))).toEqual({ format: "mp3", mime: "audio/mpeg", ext: "mp3", playable: true });
    expect(sniffAudio(bytes([0xff, 0xfb, 0x90, 0x64]))?.format).toBe("mp3");
    expect(sniffAudio(bytes([0, 0, 0, 0x20], "ftypM4A "))).toEqual({ format: "m4a", mime: "audio/mp4", ext: "m4a", playable: true });
    expect(sniffAudio(bytes([0, 0, 0, 0x18], "ftypmp42"))?.format).toBe("m4a");
    expect(sniffAudio(bytes([0, 0, 0, 0x18], "ftypisom"))?.format).toBe("m4a");
    expect(sniffAudio(bytes("RIFF", [0x24, 0x08, 0, 0], "WAVE"))).toEqual({ format: "wav", mime: "audio/wav", ext: "wav", playable: true });
    expect(sniffAudio(bytes("OggS", [0, 2]))).toEqual({ format: "ogg", mime: "audio/ogg", ext: "ogg", playable: true });
    expect(sniffAudio(bytes("#!AMR\n"))).toEqual({ format: "amr", mime: "audio/amr", ext: "amr", playable: false });
    expect(sniffAudio(bytes([0, 0, 0, 0x14], "ftyp3gp4"))).toEqual({ format: "3gp", mime: "audio/3gpp", ext: "3gp", playable: false });
  });
  it("returns null for anything else", () => {
    expect(sniffAudio(bytes([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]))).toBeNull();
    expect(sniffAudio(bytes("<!DOCTYPE html>"))).toBeNull();
    expect(sniffAudio(bytes("RIFF", [0, 0, 0, 0], "AVI "))).toBeNull();
    expect(sniffAudio(bytes([0, 0, 0, 0x18], "ftypqt  "))).toBeNull();
    expect(sniffAudio(new Uint8Array())).toBeNull();
  });
});

describe("checkRecordingUrl", () => {
  it("allows Callyzer's media host over https", () => {
    expect(checkRecordingUrl("https://media1.callyzer.co/a.mp3")).toEqual({ ok: true });
    expect(checkRecordingUrl("https://media1.callyzer.co:443/recordings/a.mp3")).toEqual({ ok: true });
  });
  it("refuses anything else, naming the host only", () => {
    const cases = [
      "http://media1.callyzer.co/a.mp3",
      "https://media1.callyzer.co.evil.com/a.mp3",
      "https://user@media1.callyzer.co/a.mp3",
      "https://media1.callyzer.co:8443/a.mp3",
      "https://cdn.callyzer.co/secret-path/a.mp3",
    ];
    for (const url of cases) {
      const result = checkRecordingUrl(url);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.host).toBe(new URL(url).hostname);
      expect(result.reason).toContain(result.host);
      expect(result.reason).not.toContain("/a.mp3");
      expect(result.reason).not.toContain("secret-path");
    }
    expect(checkRecordingUrl("https://cdn.callyzer.co/secret-path/a.mp3")).toEqual({ ok: false, reason: "recording host not allowed: cdn.callyzer.co", host: "cdn.callyzer.co" });
    expect(checkRecordingUrl("not a link")).toEqual({ ok: false, reason: "recording link is not a valid URL", host: null });
  });
});

describe("storagePathPrefix", () => {
  it("is the IST month and the first 32 hex of the id's sha256 (the SQL lease builds the same)", () => {
    expect(storagePathPrefix("test-call-1", "2026-11-19T14:06:00+05:30")).toBe("calls/2026/11/788f87f29c369a08e4490c0c165666df");
  });
  it("uses the month in India", () => {
    expect(storagePathPrefix("test-call-1", "2026-10-31T23:50:00+05:30")).toMatch(/^calls\/2026\/10\/[0-9a-f]{32}$/);
    expect(storagePathPrefix("test-call-1", "2026-10-31T18:40:00Z")).toMatch(/^calls\/2026\/11\//);
  });
  it("carries no phone number or name", () => {
    const path = storagePathPrefix("9820123456-Rakesh", "2026-11-19T14:06:00+05:30");
    expect(path).not.toContain("9820123456");
    expect(path).not.toContain("Rakesh");
  });
});

describe("downloadRecording", () => {
  const LINK = "https://media1.callyzer.co/recordings/2026/11/19/fixture-1.mp3";
  /** An MP3 of `size` bytes: an ID3 header and zeros. */
  const mp3 = (size: number) => {
    const out = new Uint8Array(size);
    out.set([0x49, 0x44, 0x33, 4, 0]);
    return out;
  };
  /** A fetch that answers once and records what it was asked. */
  const answer = (respond: () => Response | Promise<Response>) => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const impl: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), init });
      return respond();
    };
    return { impl, seen };
  };
  const audio = (body: Uint8Array | string, headers: Record<string, string> = {}) =>
    new Response(typeof body === "string" ? body : new Blob([body as BlobPart]), { status: 200, headers: { "content-type": "audio/mpeg", ...headers } });

  it("downloads a real recording without headers, without redirects and with a timeout", async () => {
    const { impl, seen } = answer(() => audio(mp3(90_000)));
    const result = await downloadRecording(impl, LINK, 60);
    expect(result).toMatchObject({ kind: "ok", mime: "audio/mpeg", format: "mp3", playable: true });
    expect(result.kind === "ok" && result.bytes.byteLength).toBe(90_000);
    expect(seen[0].url).toBe(LINK);
    expect(seen[0].init?.redirect).toBe("error");
    expect(seen[0].init?.headers).toBeUndefined();
    expect(seen[0].init?.signal).toBeInstanceOf(AbortSignal);
  });
  it("calls a file below the format's floor, or under 4 KB whatever it holds, an empty stub", async () => {
    expect(await downloadRecording(answer(() => audio(mp3(10_000))).impl, LINK, 60)).toEqual({ kind: "empty", bytes: 10_000 });
    expect(await downloadRecording(answer(() => audio(new Uint8Array(2_000))).impl, LINK, 60)).toEqual({ kind: "empty", bytes: 2_000 });
    expect(await downloadRecording(answer(() => audio(new Uint8Array(0))).impl, LINK, 60)).toEqual({ kind: "empty", bytes: 0 });
  });
  it("refuses a host that is not Callyzer's media host without fetching", async () => {
    const { impl, seen } = answer(() => audio(mp3(90_000)));
    const result = await downloadRecording(impl, "https://cdn.example.com/secret/a.mp3", 60);
    expect(result).toEqual({ kind: "error", outcome: "content", errorKind: "host", message: "recording host not allowed: cdn.example.com", host: "cdn.example.com" });
    expect(seen).toHaveLength(0);
  });
  it("sorts failures into transient, content and too_large", async () => {
    const outcome = async (respond: () => Response) => {
      const r = await downloadRecording(answer(respond).impl, LINK, 60);
      return r.kind === "error" ? [r.outcome, r.errorKind] : [r.kind];
    };
    expect(await outcome(() => new Response("gone", { status: 404 }))).toEqual(["content", "http"]);
    expect(await outcome(() => new Response("forbidden", { status: 403 }))).toEqual(["content", "http"]);
    expect(await outcome(() => new Response("busy", { status: 503 }))).toEqual(["transient", "http"]);
    expect(await outcome(() => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }))).toEqual(["content", "type"]);
    expect(await outcome(() => audio(new Uint8Array(90_000).fill(0x41)))).toEqual(["content", "format"]);
    expect(await outcome(() => new Response(new Blob([mp3(90_000) as BlobPart]), { status: 200, headers: { "content-type": "application/octet-stream" } }))).toEqual(["ok"]);
    expect(await outcome(() => audio("x", { "content-length": String(MAX_RECORDING_BYTES + 1) }))).toEqual(["too_large", "too_large"]);
  });
  it("stops reading a body that passes 50 MB without saying so up front", async () => {
    let served = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = new Uint8Array(1024 * 1024);
        if (served === 0) chunk.set([0x49, 0x44, 0x33]);
        served += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const result = await downloadRecording(answer(() => new Response(endless, { status: 200, headers: { "content-type": "audio/mpeg" } })).impl, LINK, 60);
    expect(result).toMatchObject({ kind: "error", outcome: "too_large" });
    expect(served).toBeLessThanOrEqual(MAX_RECORDING_BYTES + 2 * 1024 * 1024);
  });
  it("calls a redirect content, and a timeout or a network failure transient", async () => {
    const thrown = async (error: Error) => {
      const r = await downloadRecording(async () => Promise.reject(error), LINK, 60);
      return r.kind === "error" ? [r.outcome, r.errorKind] : [r.kind];
    };
    expect(await thrown(new TypeError("fetch failed", { cause: new Error("unexpected redirect") }))).toEqual(["content", "redirect"]);
    expect(await thrown(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toEqual(["transient", "timeout"]);
    expect(await thrown(new TypeError("fetch failed"))).toEqual(["transient", "network"]);
  });
  it("never puts the link in a message", async () => {
    for (const respond of [() => new Response("", { status: 404 }), () => new Response("", { status: 503 }), () => new Response("<p>", { status: 200, headers: { "content-type": "text/html" } })]) {
      const r = await downloadRecording(answer(respond).impl, LINK, 60);
      expect(r.kind === "error" && r.message).not.toContain("https://");
      expect(r.kind === "error" && r.message).not.toContain("media1.callyzer.co");
    }
  });
});
