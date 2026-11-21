// A phone call's stage in words: the Calls list row, the call page's header, timeline and hints, and the
// problems the status line names. Pure. Wherever a call is in the same state as a meeting, the meeting's
// words are used ("Waiting for the next run", "Analysing", "Needs your decision"); stale stages say so at
// the documented times, with the moment the system acts on its own.

import type { CallFeedStatus } from "@/lib/calls/feed";
import { formatTimeIst, IST } from "@/lib/format";
import { isBusinessType } from "./audio-access";
import type { MeetingType, ProcessStatus, StepState, Tone } from "./status";

export type CallStageKey = "transcribing" | "transcribing_retry" | "queued" | "writing" | "decide" | "done" | "not_work" | "no_speech" | "failed";

export interface CallStage {
  key: CallStageKey;
  word: string;
  tone: Tone;
  hint: string | null;
}

/** The meetings columns a stage needs. */
export interface StageMeeting {
  process_status: ProcessStatus;
  type: MeetingType;
  transcript_ready: boolean;
  claimed_at: string | null;
  updated_at: string;
  failure_reason: string | null;
  type_reason: string | null;
}

/** The phone_calls columns a stage needs. */
export interface StageCall {
  stt_error_kind: string | null;
  stt_next_try_at: string | null;
  stored_at: string;
  ready_at: string | null;
  decision_reason: string | null;
  decision_since: string | null;
  skip_code: string | null;
}

export interface StageOptions {
  now: Date;
  pipelinePaused: boolean;
  claimTimeoutMin: number;
  decisionHours: number;
  undecidedFailedDays: number;
  /** The feed's sttError: transcription stopped for every call (the key, the credit or today's cap). */
  sttStop?: string | null;
}

/** Past these, a stage says it is taking longer than usual (minutes). */
export const USUAL_MINUTES = { transcribing: 5, queued: 6, writing: 8 } as const;

const day = (iso: string | number, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: IST, ...options }).format(new Date(iso));

/** "14:30, 21 Nov" in IST. */
export const formatClockDayIst = (iso: string | number): string => `${formatTimeIst(new Date(iso))}, ${day(iso, { day: "numeric", month: "short" })}`;

/** "Sun 23 Nov" in IST. */
export const formatDayIst = (iso: string | number): string => day(iso, { weekday: "short", day: "numeric", month: "short" }).replace(/,/g, "");

/** "Tue 18 Nov, 11:40" in IST; the year is added when it is not this year. */
export function formatCallWhen(iso: string, now: Date = new Date()): string {
  const year = (d: string | Date) => day(typeof d === "string" ? d : d.toISOString(), { year: "numeric" });
  const date = day(iso, { weekday: "short", day: "numeric", month: "short", ...(year(iso) !== year(now) ? { year: "numeric" } : {}) }).replace(/,/g, "");
  return `${date}, ${formatTimeIst(iso)}`;
}

/** The routine's and the database's failure text speaks of meetings; on a call page it is a call. */
export function callFailureText(reason: string | null | undefined): string {
  const text = reason?.trim() || "The call could not be processed.";
  return text.replace(/\bmeeting(s?)\b/gi, (word, s: string) => (word[0] === "M" ? "Call" : "call") + s);
}

const at = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

export function callStage(m: StageMeeting, c: StageCall, opts: StageOptions): CallStage {
  const now = opts.now.getTime();
  const minutesSince = (iso: string | null | undefined) => {
    const t = at(iso);
    return Number.isFinite(t) ? (now - t) / 60_000 : Infinity;
  };
  switch (m.process_status) {
    case "new":
    case "waiting_transcript": {
      if (opts.pipelinePaused) return { key: "transcribing_retry", word: "Transcribing", tone: "slate", hint: "Paused by an admin." };
      const kind = c.stt_error_kind ?? opts.sttStop ?? null;
      if (kind) {
        let hint: string;
        if (kind === "auth" || kind === "credit") hint = "Paused: the transcription service refused the key or is out of credit.";
        else if (kind === "cap") hint = "Today's limit is reached; it continues tomorrow.";
        else {
          const next = at(c.stt_next_try_at);
          hint = Number.isFinite(next) && next > now ? `Retrying automatically at ${formatTimeIst(new Date(next))}.` : "Being retried now.";
        }
        return { key: "transcribing_retry", word: "Transcribing", tone: "slate", hint };
      }
      return {
        key: "transcribing",
        word: "Transcribing",
        tone: "pulse",
        hint: minutesSince(c.stored_at) < USUAL_MINUTES.transcribing ? "Usually under a minute." : "Taking longer than usual; it is retried automatically.",
      };
    }
    case "ready": {
      // A retried or re-run call is queued again from its last change, not from its first transcript.
      const since = Math.max(at(c.ready_at) || 0, at(m.updated_at) || 0);
      const hint = opts.pipelinePaused
        ? "Sheets are paused by an admin."
        : since && (now - since) / 60_000 < USUAL_MINUTES.queued
          ? "Usually starts within a couple of minutes."
          : "Taking longer than usual; a run is started automatically.";
      return { key: "queued", word: "Waiting for the next run", tone: "slate", hint };
    }
    case "processing": {
      const claimed = at(m.claimed_at);
      const hint =
        minutesSince(m.claimed_at) < USUAL_MINUTES.writing
          ? "Usually 2–4 minutes."
          : Number.isFinite(claimed)
            ? `Taking longer than usual; if the run stopped, it is retried by ${formatTimeIst(new Date(claimed + opts.claimTimeoutMin * 60_000))}.`
            : "Taking longer than usual; if the run stopped, it is retried automatically.";
      return { key: "writing", word: "Analysing", tone: "pulse", hint };
    }
    case "needs_decision": {
      const since = at(c.decision_since);
      const hint =
        c.decision_reason === "unsure" && Number.isFinite(since)
          ? `The routine was not sure this is a work call. Deleted at ${formatClockDayIst(since + opts.decisionHours * 3_600_000)} unless someone decides.`
          : "Held for a person to decide.";
      return { key: "decide", word: "Needs your decision", tone: "sienna", hint };
    }
    case "done":
      return { key: "done", word: "Sheet ready", tone: "bottle", hint: null };
    case "skipped":
      return c.skip_code === "no_speech"
        ? { key: "no_speech", word: "No speech", tone: "muted", hint: m.type_reason }
        : { key: "not_work", word: "Not a work call", tone: "muted", hint: m.type_reason };
    case "failed": {
      let hint = callFailureText(m.failure_reason);
      const updated = at(m.updated_at);
      if (!isBusinessType(m.type) && Number.isFinite(updated)) {
        hint += ` Deleted on ${formatDayIst(updated + opts.undecidedFailedDays * 86_400_000)} unless someone retries or decides.`;
      }
      return { key: "failed", word: "Failed", tone: "signal", hint };
    }
  }
}

/** Still moving through the pipeline: the list polls and the page listens while any call is. */
export const isCallInProgress = (status: ProcessStatus): boolean => status === "new" || status === "waiting_transcript" || status === "ready" || status === "processing";

export interface CallTimelineStep {
  key: "received" | "transcribed" | "queued" | "analysing" | "ready";
  label: string;
  state: StepState;
  hint?: string;
}

/** The five steps before a call's sheet exists; the active one carries the stage's hint. */
export function callTimeline(m: StageMeeting, c: StageCall, hint: string | null = null): CallTimelineStep[] {
  const s = m.process_status;
  const transcribed: StepState = m.transcript_ready ? "done" : s === "failed" ? "failed" : "active";
  const queued: StepState = s === "ready" ? "active" : s === "processing" || s === "done" ? "done" : "todo";
  const analysing: StepState = s === "processing" ? "active" : s === "done" ? "done" : s === "failed" && m.transcript_ready ? "failed" : "todo";
  const ready: StepState = s === "done" ? "done" : "todo";
  const hintFor = (state: StepState) => (state === "active" && hint ? hint : undefined);
  return [
    { key: "received", label: `Recording received at ${formatTimeIst(c.stored_at)}`, state: "done" },
    { key: "transcribed", label: transcribed === "done" ? "Transcribed" : transcribed === "failed" ? "Transcription failed" : "Transcribing", state: transcribed, hint: hintFor(transcribed) },
    { key: "queued", label: "Waiting for the next run", state: queued, hint: hintFor(queued) },
    { key: "analysing", label: "Analysing the call", state: analysing, hint: hintFor(analysing) },
    { key: "ready", label: "Sheet ready", state: ready },
  ];
}

/** "Client call" (bottle) or "Vendor call" (neutral); the short form for list rows. Null until it is business. */
export function callTypeChip(type: MeetingType, short = false): { label: string; tone: "bottle" | "neutral" } | null {
  if (type === "client") return { label: short ? "Client" : "Client call", tone: "bottle" };
  if (type === "vendor") return { label: short ? "Vendor" : "Vendor call", tone: "neutral" };
  return null;
}

/**
 * Who the call was with: the client -> the saved contact (business calls only) -> the routine's guess ->
 * the masked number. `masked` marks the last, which is set in mono.
 */
export function callWho(m: { type: MeetingType; client: { name: string } | null; client_name_guess: string | null }, c: { counterpart_name: string | null; counterpart_masked: string }): { text: string; masked: boolean } {
  if (m.client?.name) return { text: m.client.name, masked: false };
  if (isBusinessType(m.type) && c.counterpart_name) return { text: c.counterpart_name, masked: false };
  if (m.client_name_guess) return { text: m.client_name_guess, masked: false };
  return { text: c.counterpart_masked, masked: true };
}

/** The browser tab: "Rakesh Cafe 89 · Call, 18 Nov 11:40". */
export const callTabTitle = (who: string, happenedAt: string): string => `${who} · Call, ${day(happenedAt, { day: "numeric", month: "short" })} ${formatTimeIst(happenedAt)}`;

export interface FeedProblem {
  key: string;
  tone: "neutral" | "signal";
  text: string;
}

const POLL_CONFIG_ERRORS = new Set(["auth", "add_on", "empty", "host", "bad_request"]);
/** A transient poll error is only worth saying after this long without a good poll. */
const SLOW_POLL_MS = 30 * 60_000;

/**
 * What is wrong with the feed, for the people looking at it: admins get the cause and the fix, members a
 * plain line or nothing. A switch that stops everything is said alone.
 */
export function feedProblems(status: CallFeedStatus | null, opts: { isAdmin: boolean; capMinutes: number; now: Date }): FeedProblem[] {
  if (!status) return [];
  const admin = opts.isAdmin;
  const out: FeedProblem[] = [];
  const add = (key: string, tone: FeedProblem["tone"], adminText: string, memberText: string | null) => {
    const text = admin ? adminText : memberText;
    if (text) out.push({ key, tone, text });
  };
  if (status.off === "tripwire") {
    add("tripwire", "signal", "Refusing to run: this deployment points at a different database.", null);
    return out;
  }
  if (status.off === "not_configured") {
    add("not_configured", "neutral", "Phone calls need the Callyzer and Deepgram keys on Vercel.", "Phone calls aren't switched on yet.");
    return out;
  }
  if (status.paused) {
    add("paused", "neutral", "Phone calls are paused. Settings → Phone calls.", "Phone calls are paused.");
    return out;
  }
  if (status.linesOn === 0) {
    add("no_lines", "neutral", "Choose which DNY phones to analyse in Settings → Phone calls.", "No phone lines are switched on yet.");
    return out;
  }
  if (status.pipelinePaused) add("pipeline_paused", "neutral", "Sheets are paused (Settings → Pipeline); calls wait untranscribed.", "Sheets are paused by an admin.");
  if (status.pollError) {
    if (POLL_CONFIG_ERRORS.has(status.pollError)) {
      add(
        "poll_config",
        "signal",
        "Callyzer refused the key, the API add-on is inactive, or it returned nothing. CALLYZER_API_BASE and CALLYZER_API_KEY must be the pair Sales QA uses.",
        "New calls are delayed: the Callyzer connection needs an admin.",
      );
    } else {
      const lastOk = at(status.lastPollOkAt);
      if (!Number.isFinite(lastOk) || opts.now.getTime() - lastOk >= SLOW_POLL_MS) add("poll_slow", "neutral", "Callyzer is slow to answer; retrying automatically.", null);
    }
  }
  if (status.copyError) {
    if (status.copyError.kind === "host") {
      add("copy_host", "signal", `Recordings can't be copied: Callyzer now serves them from ${status.copyError.host ?? "a new host"}. Add it to RECORDING_HOSTS in src/lib/calls/media.ts.`, "New calls are delayed; an admin has been told.");
    } else {
      add("copy", "neutral", `Recordings can't be copied (${status.copyError.kind}); retrying automatically.`, null);
    }
  }
  if (status.sttError === "auth" || status.sttError === "credit") {
    add("stt_key", "signal", "Transcription stopped: Deepgram refused the key or is out of credit.", "Transcription is paused; an admin has been told.");
  } else if (status.sttError === "cap") {
    add("stt_cap", "neutral", `Today's transcription limit (${opts.capMinutes} min) is reached; calls continue tomorrow, or raise it in Settings.`, "New calls will be transcribed tomorrow.");
  }
  return out;
}

/** A switch that stops the whole feed: the list shows the problem instead of the "No calls yet" card. */
export const blocksFeed = (problems: FeedProblem[]): boolean => problems.some((p) => p.key === "tripwire" || p.key === "not_configured" || p.key === "paused" || p.key === "no_lines");
