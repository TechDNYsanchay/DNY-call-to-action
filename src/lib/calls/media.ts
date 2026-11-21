// Recordings: which links may be downloaded, the download itself, what the bytes are, whether they are an
// empty stub, and where the copy goes in the private bucket. Callyzer's links are bearer URLs that never
// expire (media1.callyzer.co, plain HTTPS, no query string), so only the host is ever logged or stored.

import { createHash } from "node:crypto";
import { istDate } from "@/lib/format";
import { isTimeoutError, TIMEOUT_MS } from "./budget";
import type { AudioFormat } from "./types";

/** Hosts recordings may be copied from. A new Callyzer media host fails visibly until it is added here. */
export const RECORDING_HOSTS = ["media1.callyzer.co"] as const;

/** https, an allowed host exactly, no credentials, the default port. The reason names the host, never the path. */
export function checkRecordingUrl(url: string): { ok: true } | { ok: false; reason: string; host: string | null } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "recording link is not a valid URL", host: null };
  }
  const host = u.hostname;
  if (u.protocol !== "https:") return { ok: false, reason: `recording link is not https: ${host}`, host };
  if (u.username || u.password) return { ok: false, reason: `recording link carries credentials: ${host}`, host };
  if (u.port) return { ok: false, reason: `recording link uses port ${u.port}: ${host}`, host };
  if (!(RECORDING_HOSTS as readonly string[]).includes(host)) return { ok: false, reason: `recording host not allowed: ${host}`, host };
  return { ok: true };
}

interface FormatInfo {
  mime: string;
  ext: string;
  /** Plays in a browser's <audio>; the others offer a download only. */
  playable: boolean;
  /** Below this many bytes per second of Callyzer's duration the file is an empty stub. */
  stubFloor: number;
}

const FORMATS: Record<AudioFormat, FormatInfo> = {
  mp3: { mime: "audio/mpeg", ext: "mp3", playable: true, stubFloor: 1_500 },
  m4a: { mime: "audio/mp4", ext: "m4a", playable: true, stubFloor: 1_500 },
  wav: { mime: "audio/wav", ext: "wav", playable: true, stubFloor: 4_000 },
  ogg: { mime: "audio/ogg", ext: "ogg", playable: true, stubFloor: 500 },
  amr: { mime: "audio/amr", ext: "amr", playable: false, stubFloor: 300 },
  "3gp": { mime: "audio/3gpp", ext: "3gp", playable: false, stubFloor: 300 },
};

/** Any recording smaller than this is a stub, whatever its length. */
export const MIN_RECORDING_BYTES = 4_096;

const ascii = (head: Uint8Array, from: number, to: number) => String.fromCharCode(...head.subarray(from, to));

function formatOf(head: Uint8Array): AudioFormat | null {
  if (ascii(head, 0, 3) === "ID3") return "mp3";
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand.startsWith("3g")) return "3gp";
    if (brand === "M4A " || brand === "mp42" || brand === "isom") return "m4a";
    return null;
  }
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") return "wav";
  if (ascii(head, 0, 4) === "OggS") return "ogg";
  if (ascii(head, 0, 5) === "#!AMR") return "amr";
  // An MPEG audio frame without an ID3 tag starts with the 11-bit sync word.
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "mp3";
  return null;
}

/** What the first bytes (16 are enough) say the file is; null for anything that is not a known audio format. */
export function sniffAudio(head: Uint8Array): { format: AudioFormat; mime: string; ext: string; playable: boolean } | null {
  const format = formatOf(head);
  if (!format) return null;
  const { mime, ext, playable } = FORMATS[format];
  return { format, mime, ext, playable };
}

/**
 * About a quarter of Callyzer's links for long calls are empty stubs (1-10 KB for a 27-108 s call). A stub
 * is never uploaded or sent for transcription.
 */
export function isStubRecording(bytes: number, durationSec: number, format: AudioFormat): boolean {
  return bytes < MIN_RECORDING_BYTES || bytes < durationSec * FORMATS[format].stubFloor;
}

/**
 * The fixed part of a call's object path: calls/{yyyy}/{mm (IST)}/{first 32 hex of sha256(call id)}. Each copy
 * lease (claim_call_work) adds "-" and 8 random hex digits, so no path is ever reused. No number, no name.
 */
export function storagePathPrefix(id: string, startedAtIso: string): string {
  const [yyyy, mm] = istDate(startedAtIso).split("-");
  const hash = createHash("sha256").update(id, "utf8").digest("hex").slice(0, 32);
  return `calls/${yyyy}/${mm}/${hash}`;
}

/** The bucket's own limit; a 90-minute call at 32 kbps is about 21 MB. */
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;

/**
 * How one download ended. transient (host 5xx, timeout, network) is retried with a backoff; content
 * (4xx, redirect, wrong type, unknown format, host not allowed) counts towards the copy's attempts;
 * too_large is final. Messages name at most the host, never the link.
 */
export type DownloadResult =
  | { kind: "ok"; bytes: Uint8Array; mime: string; format: AudioFormat; playable: boolean }
  | { kind: "empty"; bytes: number }
  | { kind: "error"; outcome: "transient" | "content" | "too_large"; errorKind: string; message: string; host?: string };

const contentError = (errorKind: string, message: string, host?: string): DownloadResult => ({ kind: "error", outcome: "content", errorKind, message, ...(host ? { host } : {}) });

/** Node's fetch reports a refused redirect as "fetch failed" caused by "unexpected redirect". */
const isRedirectError = (error: unknown): boolean => error instanceof Error && error.cause instanceof Error && /redirect/i.test(error.cause.message);

/** The body, or null as soon as it passes `max` bytes (the rest is never read). */
async function readAtMost(response: Response, max: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/**
 * Downloads a recording link with no headers added (the links are plain HTTPS), no redirects and a 20 s
 * timeout, then checks it in order: status 200, an audio content type, at most 50 MB (declared, then as
 * read: a longer body is never held in memory), a known audio format by its first bytes, and the stub rule. Anything under 4 KB is a stub whatever its first bytes say: no
 * real recording of a 45 s call is that small in any format.
 */
export async function downloadRecording(fetchImpl: typeof fetch, url: string, durationSec: number): Promise<DownloadResult> {
  const check = checkRecordingUrl(url);
  if (!check.ok) return contentError("host", check.reason, check.host ?? undefined);
  let response: Response;
  try {
    response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS.download) });
  } catch (error) {
    if (isRedirectError(error)) return contentError("redirect", "the recording link redirected to another address");
    if (isTimeoutError(error)) return { kind: "error", outcome: "transient", errorKind: "timeout", message: `downloading the recording took longer than ${TIMEOUT_MS.download / 1000} s` };
    return { kind: "error", outcome: "transient", errorKind: "network", message: "the recording host could not be reached" };
  }
  const discard = () => response.body?.cancel().catch(() => undefined);
  if (response.status !== 200) {
    await discard();
    if (response.status >= 500) return { kind: "error", outcome: "transient", errorKind: "http", message: `the recording host answered HTTP ${response.status}` };
    return contentError("http", `the recording host answered HTTP ${response.status}`);
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("audio/") && type !== "application/octet-stream") {
    await discard();
    return contentError("type", `the recording host sent ${type || "no content type"}, not audio`);
  }
  const declared = Number(response.headers.get("content-length"));
  const tooLarge: DownloadResult = { kind: "error", outcome: "too_large", errorKind: "too_large", message: `the recording is larger than ${MAX_RECORDING_BYTES / 1024 / 1024} MB` };
  if (Number.isFinite(declared) && declared > MAX_RECORDING_BYTES) {
    await discard();
    return tooLarge;
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await readAtMost(response, MAX_RECORDING_BYTES);
  } catch (error) {
    const timedOut = isTimeoutError(error);
    return { kind: "error", outcome: "transient", errorKind: timedOut ? "timeout" : "network", message: timedOut ? `downloading the recording took longer than ${TIMEOUT_MS.download / 1000} s` : "the recording download was cut off" };
  }
  if (!bytes) return tooLarge;
  if (bytes.byteLength < MIN_RECORDING_BYTES) return { kind: "empty", bytes: bytes.byteLength };
  const sniffed = sniffAudio(bytes.subarray(0, 16));
  if (!sniffed) return contentError("format", "the recording is not a known audio format");
  if (isStubRecording(bytes.byteLength, durationSec, sniffed.format)) return { kind: "empty", bytes: bytes.byteLength };
  return { kind: "ok", bytes, mime: sniffed.mime, format: sniffed.format, playable: sniffed.playable };
}
