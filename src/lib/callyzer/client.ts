// Callyzer's call-history API (POST {CALLYZER_API_BASE}/admin/api/call/callHistory), read with the company
// key Sales QA also uses. The v2.3 API is not used: on this key it only serves a locked date window.
// Ported from Sales QA's src/lib/ingest/callyzer-api.ts with its paging fixed (it stopped when
// recordsTotal was missing). Callyzer allows one request per second per key and Sales QA polls at :00,
// :15, :30 and :45 UTC, so every request first waits for a free moment (src/lib/calls/schedule.ts) and
// requests stay 2.5 s apart. Errors carry a kind the job turns into holds and alerts; no message ever holds
// the key or a response body.

import type { CallsDeps, RunState } from "@/lib/calls/deps";
import { isTimeoutError, POLL_LAST_REQUEST_MS, QUIET_MAX_WAIT_MS, TIMEOUT_MS } from "@/lib/calls/budget";
import { CALLYZER_MAX_PAGES, CALLYZER_PAGE_SIZE, quietWaitMs, shouldFetchMore } from "@/lib/calls/schedule";
import type { DayWindow } from "@/lib/calls/types";
import { parseCallHistoryEnvelope } from "./parse";

/** The only hosts CALLYZER_API_BASE may name: the sandbox (live, verified 19 Nov 2026) and production. */
export const CALLYZER_HOSTS = ["sandbox.api.callyzer.co", "api1.callyzer.co"] as const;
export const CALLYZER_HISTORY_PATH = "/admin/api/call/callHistory";
export const MIN_REQUEST_GAP_MS = 2_500;
/** Normally one request per run: today's page. Paging, the 10-minute wide read and re-reads add a few. */
export const MAX_REQUESTS_PER_RUN = 6;
/** A 429 is retried once, after Retry-After (at least 2.5 s), only when that wait is this short. */
const RATE_RETRY_MAX_MS = 10_000;

export type CallyzerErrorKind = "host" | "auth" | "add_on" | "bad_request" | "rate" | "network" | "empty" | "bad_response";

export class CallyzerError extends Error {
  readonly kind: CallyzerErrorKind;
  constructor(kind: CallyzerErrorKind, message: string) {
    super(message);
    this.name = "CallyzerError";
    this.kind = kind;
  }
}

/** Polling ends for this run without an error: a Sales QA quiet window, or the run's request budget. */
export class PollStop extends Error {
  readonly reason: "quiet" | "budget";
  constructor(reason: "quiet" | "budget") {
    super(reason === "quiet" ? "Callyzer is busy with Sales QA's poll; polling resumes next run" : "This run's Callyzer requests are used up");
    this.name = "PollStop";
    this.reason = reason;
  }
}

/** The API's origin from CALLYZER_API_BASE: https, an allowed host, no path, port or credentials. */
export function callyzerOrigin(base: string): string {
  let url: URL;
  try {
    url = new URL(base.trim());
  } catch {
    throw new CallyzerError("host", "CALLYZER_API_BASE is not a URL");
  }
  const allowed =
    url.protocol === "https:" &&
    (CALLYZER_HOSTS as readonly string[]).includes(url.hostname) &&
    !url.port &&
    !url.username &&
    !url.password &&
    (url.pathname === "/" || url.pathname === "") &&
    !url.search &&
    !url.hash;
  if (!allowed) throw new CallyzerError("host", `CALLYZER_API_BASE must be https://${CALLYZER_HOSTS[0]} or https://${CALLYZER_HOSTS[1]} (host given: ${url.hostname || "none"})`);
  return `https://${url.hostname}`;
}

export interface Pacer {
  /** Waits until a request may start; throws PollStop when none may start in this run. */
  beforeRequest(): Promise<void>;
  readonly requests: number;
}

/**
 * Keeps one run's requests at least 2.5 s apart and out of Sales QA's quiet windows. A request waits
 * through a quiet window of up to 35 s if it still starts within 90 s of the run's start; otherwise
 * polling stops for the run. At most 6 requests per run.
 */
export function createPacer(deps: Pick<CallsDeps, "now" | "sleep">, runStartedAt: Date): Pacer {
  let last: number | null = null;
  let requests = 0;
  return {
    get requests() {
      return requests;
    },
    async beforeRequest() {
      if (requests >= MAX_REQUESTS_PER_RUN) throw new PollStop("budget");
      // Re-checked after each sleep; three rounds are plenty with a real (or scripted) clock.
      for (let round = 0; round < 3; round++) {
        const now = deps.now().getTime();
        const gap = last === null ? 0 : Math.max(0, last + MIN_REQUEST_GAP_MS - now);
        const quiet = quietWaitMs(new Date(now + gap));
        if (quiet > QUIET_MAX_WAIT_MS) throw new PollStop("quiet");
        const startAt = now + gap + quiet;
        if (startAt - runStartedAt.getTime() > POLL_LAST_REQUEST_MS) throw new PollStop(quiet > 0 ? "quiet" : "budget");
        if (startAt <= now) {
          last = now;
          requests++;
          return;
        }
        await deps.sleep(startAt - now);
      }
      throw new PollStop("quiet");
    },
  };
}

/** Retry-After in ms: seconds, or an HTTP date; null when absent or unreadable. */
function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

function kindForStatus(status: number): CallyzerErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "add_on";
  if (status === 408 || status >= 500) return "network";
  return "bad_request";
}

const STATUS_TEXT: Partial<Record<CallyzerErrorKind, string>> = {
  auth: "the API key was refused",
  add_on: "the API add-on or subscription has expired",
  bad_request: "the request was rejected",
  network: "the API had an error",
};

/** One page; retries a 429 once. Returns the parsed JSON body. */
async function requestPage(deps: CallsDeps, origin: string, key: string, w: DayWindow, recordFrom: number, pacer: Pacer, run: RunState): Promise<unknown> {
  let retried = false;
  for (;;) {
    await pacer.beforeRequest();
    run.counts.callyzerRequests++;
    let response: Response;
    try {
      response = await deps.fetch(`${origin}${CALLYZER_HISTORY_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        // Every value is a string, as the API expects.
        body: JSON.stringify({
          callStartDate: w.from,
          callEndDate: w.to,
          callTypes: "Incoming,Outgoing",
          recordFrom: String(recordFrom),
          pageSize: String(CALLYZER_PAGE_SIZE),
        }),
        // A redirect would carry the key elsewhere: refuse it.
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS.callyzer),
      });
    } catch (error) {
      throw new CallyzerError("network", isTimeoutError(error) ? `Callyzer did not answer within ${TIMEOUT_MS.callyzer / 1000} s` : "Callyzer could not be reached");
    }
    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined);
      const now = deps.now().getTime();
      const wait = Math.max(retryAfterMs(response.headers.get("retry-after"), now) ?? 0, MIN_REQUEST_GAP_MS);
      if (!retried && wait <= RATE_RETRY_MAX_MS && now + wait - run.startedAt.getTime() <= POLL_LAST_REQUEST_MS) {
        retried = true;
        await deps.sleep(wait);
        continue;
      }
      throw new CallyzerError("rate", "Callyzer answered 429: too many requests for this key (Sales QA uses it too)");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const kind = kindForStatus(response.status);
      throw new CallyzerError(kind, `Callyzer answered HTTP ${response.status}: ${STATUS_TEXT[kind]}`);
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new CallyzerError("network", "Callyzer's answer was cut off");
    }
    // The sandbox host answers 200 with nothing at all for dates outside the window it serves.
    if (!text.trim()) throw new CallyzerError("empty", "Callyzer answered with an empty body");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new CallyzerError("bad_response", "Callyzer's answer was not JSON");
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new CallyzerError("bad_response", "Callyzer's answer was not the call-history envelope");
    return json;
  }
}

/**
 * Every call in one window of IST days, page by page (100 rows a page, at most 10 pages). Throws
 * CallyzerError for anything Callyzer got wrong, PollStop when the run may not send another request.
 */
export async function fetchCallHistory(deps: CallsDeps, cfg: { base: string; key: string }, w: DayWindow, pacer: Pacer, run: RunState): Promise<unknown[]> {
  const origin = callyzerOrigin(cfg.base);
  const rows: unknown[] = [];
  for (let pageNo = 1; ; pageNo++) {
    const body = await requestPage(deps, origin, cfg.key, w, (pageNo - 1) * CALLYZER_PAGE_SIZE, pacer, run);
    const page = parseCallHistoryEnvelope(body);
    rows.push(...page.rows);
    if (shouldFetchMore(page.rows.length, rows.length, page.recordsTotal, pageNo)) continue;
    if (pageNo >= CALLYZER_MAX_PAGES && page.rows.length >= CALLYZER_PAGE_SIZE && (page.recordsTotal === null || rows.length < page.recordsTotal)) {
      await deps.log("warn", "callyzer", `Callyzer has more than ${rows.length} calls for ${w.from} to ${w.to}; only the first ${rows.length} were read`);
    }
    return rows;
  }
}
