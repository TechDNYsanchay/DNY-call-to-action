import "server-only";

// The one place that talks to tl;dv's API (https://doc.tldv.io, v1alpha1). Facts that shaped it:
// auth is the x-api-key header; a custom User-Agent is required (library defaults get 403); the
// transcript endpoint answers 200 only once the transcript is complete; rate limits are undocumented,
// so 429 and 5xx are retried with backoff and jitter. Everything is parsed by src/lib/tldv/parse.ts.

import { optionalEnv, requireEnv } from "@/lib/env";
import { parseTldvMeeting, parseTldvTranscript, type TldvMeeting } from "./parse";
import type { SpeakerTurn } from "./turns";

export const TLDV_DEFAULT_BASE = "https://pasta.tldv.io/v1alpha1";
export const TLDV_USER_AGENT = "dny-call-to-action/1.0 (+https://dnyhospitality.com)";

/** A non-2xx answer from tl;dv (after retries), or a timeout (status 0). */
export class TldvError extends Error {
  readonly status: number;
  readonly path: string;
  constructor(status: number, path: string, message: string) {
    super(`tl;dv ${status || "timeout"} on ${path}: ${message}`);
    this.name = "TldvError";
    this.status = status;
    this.path = path;
  }
  /** 401 means the API key is wrong or missing: a configuration problem, not a transient one. */
  get isConfiguration(): boolean {
    return this.status === 401;
  }
}

export interface TldvClientOptions {
  apiKey?: string;
  baseUrl?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  /** Injected in tests so retries do not really wait. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Extra attempts after the first one on 429 and 5xx (and network failures). */
  retries?: number;
}

export interface ListMeetingsParams {
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  meetingType?: "internal" | "external";
  query?: string;
}

/** A parsed meeting plus the body tl;dv sent, stored as meetings.raw for later debugging. */
export type TldvMeetingWithRaw = TldvMeeting & { raw: unknown };

export interface MeetingsPage {
  page: number;
  pages: number;
  total: number;
  results: TldvMeetingWithRaw[];
}

export interface TldvTranscript {
  transcriptId: string | null;
  turns: SpeakerTurn[];
  /** Raw one-per-sentence line count from tl;dv, before merging into turns (Rule A uses it). */
  sentenceCount: number;
}

export interface TldvNotes {
  markdownContent: string | null;
  structuredNotes: unknown[];
  topics: unknown[];
}

export interface TldvClient {
  /** The meeting's metadata; null when tl;dv does not know the id (404). */
  getMeeting(id: string): Promise<TldvMeetingWithRaw | null>;
  listMeetings(params?: ListMeetingsParams): Promise<MeetingsPage>;
  /** Every meeting that happened from `fromIso` to `to` (default now), page by page. */
  listMeetingsSince(fromIso: string, options?: { maxPages?: number; to?: string; limit?: number }): Promise<TldvMeetingWithRaw[]>;
  /** The finished transcript, or null while tl;dv is still working on it (404, 403 or an empty list). */
  getTranscript(id: string): Promise<TldvTranscript | null>;
  /** tl;dv's own AI notes, for reference only; null when there are none yet. */
  getNotes(id: string): Promise<TldvNotes | null>;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 500 ms, 1.5 s, 4.5 s ... plus up to 30% jitter, so retries from parallel runs spread out. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = 500 * 3 ** attempt;
  return Math.round(base * (1 + random() * 0.3));
}

export function createTldvClient(options: TldvClientOptions = {}): TldvClient {
  const baseUrl = (options.baseUrl ?? optionalEnv("TLDV_API_BASE") ?? TLDV_DEFAULT_BASE).replace(/\/$/, "");
  const userAgent = options.userAgent ?? TLDV_USER_AGENT;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = options.retries ?? 2;
  // Resolved lazily so importing the module never throws before the env is needed.
  const apiKey = () => options.apiKey ?? requireEnv("TLDV_API_KEY");

  async function request(path: string, params?: Record<string, string | number | undefined>): Promise<Response> {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          headers: { "x-api-key": apiKey(), "user-agent": userAgent, accept: "application/json" },
          signal: controller.signal,
          cache: "no-store",
        });
        if (!RETRY_STATUSES.has(response.status) || attempt === retries) return response;
        lastError = new TldvError(response.status, path, await safeMessage(response));
      } catch (error) {
        // Timeouts and network failures are retried like a 5xx; anything else is not ours to hide.
        if (error instanceof TldvError) throw error;
        lastError = error;
        if (attempt === retries) break;
      } finally {
        clearTimeout(timer);
      }
      await sleep(backoffMs(attempt));
    }
    if (lastError instanceof TldvError) throw lastError;
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new TldvError(0, path, reason.includes("abort") ? `no answer within ${timeoutMs / 1000} s` : reason);
  }

  async function safeMessage(response: Response): Promise<string> {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    return typeof body?.message === "string" ? body.message : response.statusText || "request failed";
  }

  async function getJson(path: string, params?: Record<string, string | number | undefined>): Promise<{ status: number; body: unknown }> {
    const response = await request(path, params);
    if (!response.ok) {
      if (response.status === 404 || response.status === 403) return { status: response.status, body: null };
      throw new TldvError(response.status, path, await safeMessage(response));
    }
    return { status: response.status, body: await response.json().catch(() => null) };
  }

  const client: TldvClient = {
    async getMeeting(id) {
      const path = `/meetings/${encodeURIComponent(id)}`;
      const { status, body } = await getJson(path);
      if (status === 404) return null;
      // 403 on a meeting means the organiser's plan does not allow API export: say so, loudly.
      if (status === 403) throw new TldvError(403, path, "tl;dv refused access to this meeting (organiser's plan has no API export)");
      const meeting = parseTldvMeeting(body);
      if (!meeting) throw new TldvError(status, path, "meeting body did not have an id and happenedAt");
      return { ...meeting, raw: body };
    },

    async listMeetings(params = {}) {
      const path = "/meetings";
      const limit = Math.min(Math.max(params.limit ?? 100, 1), 100);
      const { status, body } = await getJson(path, { from: params.from, to: params.to, page: params.page ?? 1, limit, meetingType: params.meetingType, query: params.query });
      if (status !== 200 || !body) throw new TldvError(status, path, "tl;dv did not return a meetings page");
      const v = body as Record<string, unknown>;
      const rows = Array.isArray(v.results) ? v.results : [];
      const results: TldvMeetingWithRaw[] = [];
      for (const row of rows) {
        const meeting = parseTldvMeeting(row);
        if (meeting) results.push({ ...meeting, raw: row });
      }
      const page = Number(v.page) || params.page || 1;
      const total = Number(v.total) || results.length;
      const pages = Number(v.pages) || (total > 0 ? Math.ceil(total / limit) : 1);
      return { page, pages, total, results };
    },

    async listMeetingsSince(fromIso, { maxPages = 20, to, limit = 100 } = {}) {
      const all = new Map<string, TldvMeetingWithRaw>();
      const toIso = to ?? new Date().toISOString();
      for (let page = 1; page <= maxPages; page++) {
        const result = await client.listMeetings({ from: fromIso, to: toIso, page, limit });
        for (const m of result.results) all.set(m.id, m);
        if (result.results.length === 0 || page >= result.pages) break;
      }
      return [...all.values()];
    },

    async getTranscript(id) {
      const path = `/meetings/${encodeURIComponent(id)}/transcript`;
      const { status, body } = await getJson(path);
      if (status !== 200 || !body) return null;
      const turns = parseTldvTranscript(body);
      if (!turns || turns.length === 0) return null;
      const v = body as Record<string, unknown>;
      const raw = Array.isArray(v.data) ? v.data : Array.isArray(v.segments) ? v.segments : Array.isArray(body) ? body : [];
      const sentenceCount = raw.filter((line) => typeof (line as { text?: unknown })?.text === "string" && String((line as { text: string }).text).trim()).length;
      return { transcriptId: typeof v.id === "string" ? v.id : null, turns, sentenceCount: sentenceCount || turns.length };
    },

    async getNotes(id) {
      const path = `/meetings/${encodeURIComponent(id)}/notes`;
      const { status, body } = await getJson(path);
      if (status !== 200 || !body) return null;
      const v = body as Record<string, unknown>;
      const markdown = typeof v.markdownContent === "string" && v.markdownContent.trim() ? v.markdownContent : null;
      const structuredNotes = Array.isArray(v.structuredNotes) ? v.structuredNotes : [];
      const topics = Array.isArray(v.topics) ? v.topics : [];
      if (!markdown && structuredNotes.length === 0 && topics.length === 0) return null;
      return { markdownContent: markdown, structuredNotes, topics };
    },
  };
  return client;
}

let shared: TldvClient | undefined;
/** The app's client, configured from TLDV_API_KEY and TLDV_API_BASE. */
export function tldv(): TldvClient {
  shared ??= createTldvClient();
  return shared;
}

export const getMeeting = (id: string) => tldv().getMeeting(id);
export const listMeetings = (params?: ListMeetingsParams) => tldv().listMeetings(params);
export const listMeetingsSince = (fromIso: string, options?: { maxPages?: number; to?: string }) => tldv().listMeetingsSince(fromIso, options);
export const getTranscript = (id: string) => tldv().getTranscript(id);
export const getNotes = (id: string) => tldv().getNotes(id);
