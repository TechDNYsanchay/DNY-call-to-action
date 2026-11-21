// Today's calls on client lines, in words: the status line on the Calls page and in Settings. Pure.
// calls_feed_status() returns the last poll's counts (calls that were never candidates) and the ledger's
// statuses (candidates and what became of them); feedSummary turns them into four numbers that always add
// up to the day's total, plus a details list in words.

import type { TodayStats } from "./types";

export interface LedgerBuckets {
  waitingRecording: number;
  copying: number;
  noRecording: number;
  copyFailed: number;
  inProgress: number;
  sheets: number;
  needsDecision: number;
  failed: number;
  notWork: number;
  noSpeech: number;
}

/** What calls_feed_status() returns to a signed-in person: no numbers, names or links. */
export interface CallFeedStatus {
  paused: boolean;
  pipelinePaused: boolean;
  linesOn: number;
  lastRunAt: string | null;
  lastPollOkAt: string | null;
  off: string | null;
  pollError: string | null;
  sttError: string | null;
  copyError: { kind: string; host?: string; at?: string } | null;
  /** The last poll's counts when it ran today (IST); null before today's first poll. */
  poll: TodayStats | null;
  ledger: LedgerBuckets;
  minutesToday: number;
}

export type FeedDetailKey = keyof LedgerBuckets | "short" | "tooLong" | "internal" | "beforeOn" | "other";

export interface FeedSummary {
  total: number;
  sheets: number;
  /** Being copied, transcribed or analysed, or still waiting for the phone to upload the recording. */
  inProgress: number;
  /** Waiting for a person's decision, or failed. */
  needPerson: number;
  notAnalysed: number;
  /** Every non-zero bucket in words, in a fixed order. */
  details: Array<{ key: FeedDetailKey; count: number; text: string }>;
}

const LEDGER_KEYS: Array<keyof LedgerBuckets> = ["waitingRecording", "copying", "noRecording", "copyFailed", "inProgress", "sheets", "needsDecision", "failed", "notWork", "noSpeech"];

/** [key, word for one, word for several], in the order the details list shows them. */
const DETAIL_WORDS: Array<[FeedDetailKey, string, string]> = [
  ["sheets", "with a sheet", "with a sheet"],
  ["inProgress", "being transcribed or analysed", "being transcribed or analysed"],
  ["copying", "recording being copied", "recordings being copied"],
  ["waitingRecording", "still waiting for the phone to upload the recording", "still waiting for the phone to upload the recording"],
  ["needsDecision", "waiting for a person to decide", "waiting for a person to decide"],
  ["failed", "failed; it can be retried", "failed; they can be retried"],
  ["copyFailed", "recording could not be copied", "recordings could not be copied"],
  ["short", "too short or not answered", "too short or not answered"],
  ["tooLong", "too long to analyse", "too long to analyse"],
  ["internal", "with another DNY number", "with another DNY number"],
  ["beforeOn", "before the line was switched on", "before the line was switched on"],
  ["noRecording", "recording empty or never uploaded", "recordings empty or never uploaded"],
  ["notWork", "not a work call", "not work calls"],
  ["noSpeech", "with no speech in the recording", "with no speech in the recording"],
  ["other", "not analysed for another reason", "not analysed for another reason"],
];

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

export function feedSummary(status: CallFeedStatus): FeedSummary {
  const l = status.ledger;
  const p = status.poll;
  const buckets: Record<FeedDetailKey, number> = {
    ...(Object.fromEntries(LEDGER_KEYS.map((k) => [k, count(l[k])])) as Record<keyof LedgerBuckets, number>),
    short: count(p?.short),
    tooLong: count(p?.tooLong),
    internal: count(p?.internal),
    beforeOn: count(p?.beforeOn),
    other: 0,
  };
  const b = buckets;
  const ledgerTotal = LEDGER_KEYS.reduce((n, k) => n + b[k], 0);
  if (p) {
    // Candidates the poll saw that the ledger does not account for (dropped when a line was switched off
    // and on again) are "not analysed"; a ledger ahead of the poll raises the total instead.
    const candidates = p.candidates !== undefined ? count(p.candidates) : Math.max(0, count(p.onLines) - b.short - b.tooLong - b.internal - b.beforeOn);
    b.other = Math.max(0, candidates - ledgerTotal);
  }
  const sheets = b.sheets;
  const inProgress = b.copying + b.inProgress + b.waitingRecording;
  const needPerson = b.needsDecision + b.failed + b.copyFailed;
  const notAnalysed = b.short + b.tooLong + b.internal + b.beforeOn + b.noRecording + b.notWork + b.noSpeech + b.other;
  return {
    total: sheets + inProgress + needPerson + notAnalysed,
    sheets,
    inProgress,
    needPerson,
    notAnalysed,
    details: DETAIL_WORDS.filter(([key]) => b[key] > 0).map(([key, one, many]) => ({ key, count: b[key], text: `${b[key]} ${b[key] === 1 ? one : many}` })),
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** calls_feed_status()'s JSON, read defensively; null when it is not an object (signed out, or not on the team). */
export function parseFeedStatus(json: unknown): CallFeedStatus | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const ledger = (o.ledger && typeof o.ledger === "object" ? o.ledger : {}) as Record<string, unknown>;
  const copy = o.copyError && typeof o.copyError === "object" ? (o.copyError as Record<string, unknown>) : null;
  const poll = o.poll && typeof o.poll === "object" && !Array.isArray(o.poll) ? (o.poll as TodayStats) : null;
  return {
    paused: o.paused !== false,
    pipelinePaused: o.pipelinePaused === true,
    linesOn: count(o.linesOn),
    lastRunAt: str(o.lastRunAt),
    lastPollOkAt: str(o.lastPollOkAt),
    off: str(o.off),
    pollError: str(o.pollError),
    sttError: str(o.sttError),
    copyError: copy && str(copy.kind) ? { kind: String(copy.kind), ...(str(copy.host) ? { host: String(copy.host) } : {}), ...(str(copy.at) ? { at: String(copy.at) } : {}) } : null,
    poll,
    ledger: Object.fromEntries(LEDGER_KEYS.map((k) => [k, count(ledger[k])])) as unknown as LedgerBuckets,
    minutesToday: count(o.minutesToday),
  };
}
