// Deepgram nova-3, pre-recorded audio from a link: the request Sales QA runs in production
// (SA/src/lib/transcription/deepgram.ts), multilingual for Hindi-English code-switching, with diarisation
// and DNY's keyterms. Deepgram fetches the audio itself from a 10-minute signed link to the private bucket,
// and by default may not use it to improve its models (mip_opt_out, setting calls_deepgram_mip_opt_out).
// Every failure is a DeepgramError whose outcome tells finish_call_transcription how to count it; its
// message never carries a link. https://developers.deepgram.com/docs/pre-recorded-audio · /docs/keyterm

import { isTimeoutError, TIMEOUT_MS } from "./budget";
import { sanitizeForLog } from "./sanitize";
import type { DeepgramWord } from "./types";
import { DNY_TERMS } from "./vocabulary";

export const DEEPGRAM_MODEL = "nova-3";
/** phone_calls.stt_provider. */
export const DEEPGRAM_PROVIDER = `deepgram:${DEEPGRAM_MODEL}`;
const LISTEN_URL = "https://api.deepgram.com/v1/listen";

/** not_billed: refused before any audio was processed (the reserved minutes go back); transient and content count. */
export type DeepgramOutcome = "not_billed" | "transient" | "content";

export class DeepgramError extends Error {
  readonly outcome: DeepgramOutcome;
  /** auth | credit | rate | server | timeout | network | bad_audio | http | bad_response | no_words */
  readonly kind: string;
  constructor(outcome: DeepgramOutcome, kind: string, message: string) {
    super(sanitizeForLog(message));
    this.name = "DeepgramError";
    this.outcome = outcome;
    this.kind = kind;
  }
}

/** The listen URL: Sales QA's parameters, mip_opt_out when chosen, then one keyterm per DNY term in order. */
export function deepgramListenUrl(opts: { mipOptOut: boolean }): string {
  const params = new URLSearchParams({ model: DEEPGRAM_MODEL, language: "multi", diarize_model: "latest", smart_format: "true", punctuate: "true" });
  if (opts.mipOptOut) params.set("mip_opt_out", "true");
  for (const term of DNY_TERMS) params.append("keyterm", term);
  return `${LISTEN_URL}?${params}`;
}

function failureFor(status: number): [DeepgramOutcome, string] {
  if (status === 401 || status === 403) return ["not_billed", "auth"];
  if (status === 402) return ["not_billed", "credit"];
  if (status === 429) return ["not_billed", "rate"];
  if (status >= 500) return ["transient", "server"];
  if (status === 400) return ["content", "bad_audio"];
  return ["content", "http"];
}

/** Deepgram's own error text (err_msg), if any: links and tokens removed, at most 200 characters. */
async function errorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const detail = [body.err_msg, body.message, body.reason].find((v): v is string => typeof v === "string" && v.trim().length > 0);
    return detail ? sanitizeForLog(detail.replace(/\btoken=\S*/gi, "[link]")).slice(0, 200) : "";
  } catch {
    return "";
  }
}

type RawWord = { word?: unknown; punctuated_word?: unknown; start?: unknown; end?: unknown; speaker?: unknown };

/** results.channels[0].alternatives[0].words and metadata.duration; no words array is a content error. */
export function parseDeepgramResult(json: unknown): { words: DeepgramWord[]; durationSec: number | null } {
  const body = json as { results?: { channels?: Array<{ alternatives?: Array<{ words?: unknown }> }> }; metadata?: { duration?: unknown } } | null;
  const raw = body?.results?.channels?.[0]?.alternatives?.[0]?.words;
  if (!Array.isArray(raw)) throw new DeepgramError("content", "no_words", "Deepgram's answer has no words");
  const words: DeepgramWord[] = [];
  for (const w of raw as RawWord[]) {
    const start = Number(w?.start);
    if (!w || !Number.isFinite(start)) continue;
    const end = Number(w.end);
    const speaker = w.speaker === null || w.speaker === undefined ? NaN : Number(w.speaker);
    words.push({
      word: typeof w.word === "string" ? w.word : "",
      ...(typeof w.punctuated_word === "string" ? { punctuated_word: w.punctuated_word } : {}),
      start,
      end: Number.isFinite(end) ? end : start,
      ...(Number.isFinite(speaker) ? { speaker } : {}),
    });
  }
  const duration = Number(body?.metadata?.duration);
  return { words, durationSec: Number.isFinite(duration) && duration > 0 ? duration : null };
}

/** Transcribes the recording behind `signedUrl`. Throws DeepgramError; the API key is only ever a header. */
export async function transcribeWithDeepgram(
  fetchImpl: typeof fetch,
  apiKey: string,
  signedUrl: string,
  opts: { mipOptOut: boolean },
): Promise<{ words: DeepgramWord[]; durationSec: number | null }> {
  let response: Response;
  try {
    response = await fetchImpl(deepgramListenUrl(opts), {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: signedUrl }),
      signal: AbortSignal.timeout(TIMEOUT_MS.deepgram),
    });
  } catch (error) {
    if (isTimeoutError(error)) throw new DeepgramError("transient", "timeout", `Deepgram did not answer within ${TIMEOUT_MS.deepgram / 1000} s`);
    throw new DeepgramError("transient", "network", "Deepgram could not be reached");
  }
  if (!response.ok) {
    const [outcome, kind] = failureFor(response.status);
    const detail = await errorDetail(response);
    throw new DeepgramError(outcome, kind, `Deepgram answered HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    if (isTimeoutError(error)) throw new DeepgramError("transient", "timeout", `Deepgram did not answer within ${TIMEOUT_MS.deepgram / 1000} s`);
    throw new DeepgramError("content", "bad_response", "Deepgram's answer was not JSON");
  }
  return parseDeepgramResult(json);
}
