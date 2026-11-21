// The call recording player's state machine and the pure maths around it. The provider
// (src/components/calls/recording-provider.tsx) owns the one <audio> element: it feeds every media event,
// timer tick and link reply through playerReducer and runs the effects each transition asks for, so these
// rules are tested here with a fake clock and fake events:
// - the source never changes while playing: a fresher link waits for the pause or the end, and the place
//   is restored when it is applied;
// - links last an hour; while paused they are refreshed when less than 10 minutes remain, and when the tab
//   becomes visible again, so a fresh link exists before the next tap;
// - a seek before the metadata is loaded is held and applied when it is;
// - a media error fetches a new link, restores the place and resumes if it was playing;
// - anything but a stored recording stops playback and clears the source.

import type { ActionItemRow } from "@/lib/data/types";
import { secondsFrom } from "@/lib/format";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import { spokenTime } from "./evidence";
import type { SheetView } from "./sheet-result";

/** A link is refreshed when less than this is left on it. */
export const LINK_REFRESH_BEFORE_MS = 10 * 60_000;
/** A failed link request is not repeated sooner than this. */
export const LINK_RETRY_AFTER_MS = 60_000;
/** Media errors in a row before the player stops trying by itself. */
export const MAX_MEDIA_ERRORS = 2;
export const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;

export type Availability = "stored" | "not_work" | "deleted" | "unplayable" | "withheld";
export type PlayerStatus = "idle" | "fetching" | "ready" | "playing" | "unavailable" | "error";
export type PlayerReason = Exclude<Availability, "stored"> | "signed_out" | "not_classified";
export type LinkFailure = { kind: "signed_out" } | { kind: "denied"; reason: "not_work" | "deleted" | "not_classified" } | { kind: "network" };

/** What the provider must do after a transition, in order. */
export type PlayerEffect = { kind: "load"; url: string } | { kind: "clear" } | { kind: "seek"; at: number } | { kind: "play" } | { kind: "fetch" };

export interface PlayerState {
  status: PlayerStatus;
  reason: PlayerReason | null;
  /** What the page last said about the recording; null until it has. */
  availability: Availability | null;
  /** Why the call was deleted (phone_calls.skip_code), when the page says it was; words by deletedText. */
  skipCode: string | null;
  /** The link the <audio> element plays. */
  url: string | null;
  expiresAt: number | null;
  /** A fresher link waiting for a pause or the end. */
  pendingUrl: { url: string; expiresAt: number } | null;
  /** A place to apply once the current source's metadata is loaded. */
  pendingSeek: number | null;
  lastPosition: number;
  /** The current source has its metadata: seeks apply at once. */
  loaded: boolean;
  /** Bumped for every link request; a reply for an older value is dropped. */
  fetchSeq: number;
  fetching: boolean;
  failedAt: number | null;
  /** Play as soon as the next source is loaded (a media error while playing, or a tap before the link). */
  resume: boolean;
  /** The browser refused to start playback without a tap: "Tap to resume". */
  blocked: boolean;
  mediaErrors: number;
  effects: PlayerEffect[];
}

export type PlayerEvent =
  | { type: "availability"; availability: Availability; skipCode?: string | null }
  | { type: "link"; url: string; expiresAt: number }
  | { type: "link_failed"; failure: LinkFailure; now: number }
  | { type: "tick"; now: number }
  | { type: "visible"; now: number }
  | { type: "loaded" }
  | { type: "playing" }
  | { type: "paused"; position: number; ended: boolean }
  | { type: "seek"; position: number }
  | { type: "want_play" }
  | { type: "media_error"; position: number; wasPlaying: boolean }
  | { type: "blocked" }
  | { type: "retry" };

export function initialPlayerState(): PlayerState {
  return {
    status: "idle",
    reason: null,
    availability: null,
    skipCode: null,
    url: null,
    expiresAt: null,
    pendingUrl: null,
    pendingSeek: null,
    lastPosition: 0,
    loaded: false,
    fetchSeq: 0,
    fetching: false,
    failedAt: null,
    resume: false,
    blocked: false,
    mediaErrors: 0,
    effects: [],
  };
}

/** Ask for a link unless one is already on its way. */
const fetchLink = (s: PlayerState): PlayerState => (s.fetching ? s : { ...s, fetching: true, fetchSeq: s.fetchSeq + 1, effects: [...s.effects, { kind: "fetch" }] });

/** Stop and forget the source; an older link request still on its way is dropped. */
const unavailable = (s: PlayerState, reason: PlayerReason): PlayerState => ({
  ...s,
  status: "unavailable",
  reason,
  url: null,
  expiresAt: null,
  pendingUrl: null,
  loaded: false,
  resume: false,
  blocked: false,
  fetching: false,
  fetchSeq: s.fetchSeq + 1,
  effects: [...s.effects, { kind: "clear" }],
});

const place = (sec: number): number | null => (sec > 0 ? sec : null);

export function playerReducer(prev: PlayerState, event: PlayerEvent): PlayerState {
  const s: PlayerState = { ...prev, effects: [] };
  switch (event.type) {
    case "availability": {
      if (event.availability !== "stored") return { ...unavailable(s, event.availability), availability: event.availability, skipCode: event.skipCode ?? null, mediaErrors: 0 };
      const next = { ...s, availability: event.availability, skipCode: null, mediaErrors: s.availability === "stored" ? s.mediaErrors : 0 };
      if (s.reason === "signed_out") return next;
      if (s.status === "idle" || s.status === "unavailable") return fetchLink({ ...next, status: "fetching", reason: null });
      return next;
    }
    case "link": {
      if (!s.fetching || s.status === "unavailable") return s;
      const fresh = { ...s, fetching: false, failedAt: null };
      if (s.status === "playing") return { ...fresh, pendingUrl: { url: event.url, expiresAt: event.expiresAt } };
      // Paused (or no source yet): apply it now and keep the place.
      const keep = s.url !== null ? (s.pendingSeek ?? place(s.lastPosition)) : s.pendingSeek;
      return { ...fresh, status: "ready", reason: null, url: event.url, expiresAt: event.expiresAt, pendingUrl: null, loaded: false, pendingSeek: keep, effects: [{ kind: "load", url: event.url }] };
    }
    case "link_failed": {
      if (!s.fetching) return s;
      const failed = { ...s, fetching: false, failedAt: event.now };
      const f = event.failure;
      if (f.kind === "denied") return unavailable(failed, f.reason);
      if (f.kind === "signed_out") return s.status === "playing" ? failed : unavailable(failed, "signed_out");
      // A network failure keeps a link that still works and tries again later.
      if (s.url && (s.status === "ready" || s.status === "playing")) return failed;
      return { ...failed, status: "error", reason: null };
    }
    case "tick":
    case "visible": {
      if (s.fetching || (s.status !== "ready" && s.status !== "playing")) return s;
      if (s.failedAt !== null && event.now - s.failedAt < LINK_RETRY_AFTER_MS) return s;
      if (s.expiresAt !== null && s.expiresAt - event.now >= LINK_REFRESH_BEFORE_MS) return s;
      if (s.pendingUrl && s.pendingUrl.expiresAt - event.now >= LINK_REFRESH_BEFORE_MS) return s;
      return fetchLink(s);
    }
    case "loaded": {
      if (!s.url || s.loaded) return s;
      const effects: PlayerEffect[] = [];
      if (s.pendingSeek !== null) effects.push({ kind: "seek", at: s.pendingSeek });
      if (s.resume) effects.push({ kind: "play" });
      // mediaErrors is not reset here: a file that fails after loading would otherwise loop for ever.
      return { ...s, loaded: true, lastPosition: s.pendingSeek ?? s.lastPosition, pendingSeek: null, resume: false, effects };
    }
    case "playing":
      return s.url ? { ...s, status: "playing", blocked: false, resume: false } : s;
    case "paused": {
      // A pause that comes from clearing or replacing the source changes nothing.
      if (s.status !== "playing" && s.status !== "ready") return s;
      const position = event.ended ? 0 : Math.max(0, event.position);
      const paused: PlayerState = { ...s, status: "ready", lastPosition: position };
      if (!s.pendingUrl) return paused;
      const { url, expiresAt } = s.pendingUrl;
      return { ...paused, url, expiresAt, pendingUrl: null, loaded: false, pendingSeek: place(position), effects: [{ kind: "load", url }] };
    }
    case "seek": {
      const at = Math.max(0, event.position);
      if (s.url && s.loaded) return { ...s, lastPosition: at, effects: [{ kind: "seek", at }] };
      return { ...s, pendingSeek: at, lastPosition: at };
    }
    case "want_play":
      if (s.status === "error") return fetchLink({ ...s, status: "fetching", resume: true, mediaErrors: 0 });
      return { ...s, resume: true };
    case "media_error": {
      if (!s.url) return s;
      const position = Math.max(0, event.position);
      const base: PlayerState = { ...s, url: null, expiresAt: null, loaded: false, pendingSeek: place(position), lastPosition: position, resume: event.wasPlaying, blocked: false, mediaErrors: s.mediaErrors + 1 };
      if (base.mediaErrors > MAX_MEDIA_ERRORS) return { ...base, status: "error", pendingUrl: null, resume: false, effects: [{ kind: "clear" }] };
      // A fresher link already waiting is used at once; otherwise ask for one.
      if (s.pendingUrl) return { ...base, status: "ready", url: s.pendingUrl.url, expiresAt: s.pendingUrl.expiresAt, pendingUrl: null, effects: [{ kind: "load", url: s.pendingUrl.url }] };
      return fetchLink({ ...base, status: "fetching", pendingUrl: null, fetching: false });
    }
    case "blocked":
      return { ...s, blocked: true, resume: false };
    case "retry":
      if (s.status !== "error") return s;
      return fetchLink({ ...s, status: "fetching", mediaErrors: 0 });
  }
}

/** Whether pills, ticks and timestamps may play: a stored recording that has not failed. */
export const canPlayState = (s: Pick<PlayerState, "availability" | "status">): boolean => s.availability === "stored" && (s.status === "fetching" || s.status === "ready" || s.status === "playing");

/**
 * Why a deleted call's recording is gone, from phone_calls.skip_code, in the words its header uses: no speech,
 * not confirmed in time, the line switched off, or (any other code, or none known yet) not a work call.
 */
export function deletedText(skipCode: string | null | undefined): string {
  switch (skipCode) {
    case "no_speech":
      return "Deleted: no speech in the recording";
    case "undecided":
      return "Deleted: not confirmed as a work call in time";
    case "line_off":
      return "Deleted: the line was switched off";
    default:
      return "Deleted: not a work call";
  }
}

/** What the player says when it cannot play; null when it says nothing (or can play). */
export function playerMessage(s: Pick<PlayerState, "status" | "reason"> & { skipCode?: string | null }): string | null {
  if (s.status === "error") return "The recording could not be loaded.";
  if (s.status !== "unavailable") return null;
  switch (s.reason) {
    case "not_work":
      return deletedText(s.skipCode);
    case "deleted":
      return "Recording deleted after 30 days";
    case "unplayable":
      return "This recording format can't play in the browser";
    case "signed_out":
      return "You were signed out. Reload the page.";
    case "not_classified":
      return "The recording opens once the call is confirmed as a client or vendor call.";
    default:
      return null;
  }
}

/** The audio route's reply, as the response shows it to the browser. */
export interface LinkReply {
  status: number;
  redirected: boolean;
  contentType: string | null;
  body: unknown;
}

export type LinkResult = { ok: true; url: string; expiresAt: number; mime: string | null; playable: boolean } | { ok: false; failure: LinkFailure };

const DENIALS = new Set(["not_work", "deleted", "not_classified"]);

/**
 * A 401, a redirect (the login page) or a body that is not JSON means the session is gone; 5xx is the
 * network; 403/404/409 say why the audio is refused; 200 must carry an https link and its expiry.
 */
export function readLinkReply(r: LinkReply): LinkResult {
  if (r.status === 401 || r.redirected) return { ok: false, failure: { kind: "signed_out" } };
  if (r.status === 0 || r.status >= 500) return { ok: false, failure: { kind: "network" } };
  if (!(r.contentType ?? "").toLowerCase().includes("application/json")) return { ok: false, failure: { kind: "signed_out" } };
  const body = (r.body && typeof r.body === "object" ? r.body : {}) as Record<string, unknown>;
  if (r.status === 403 || r.status === 404 || r.status === 409) {
    const reason = typeof body.reason === "string" && DENIALS.has(body.reason) ? (body.reason as "not_work" | "deleted" | "not_classified") : r.status === 403 ? "not_classified" : "deleted";
    return { ok: false, failure: { kind: "denied", reason } };
  }
  const expiresAt = typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
  if (r.status !== 200 || typeof body.url !== "string" || !/^https?:\/\//.test(body.url) || !Number.isFinite(expiresAt)) return { ok: false, failure: { kind: "network" } };
  return { ok: true, url: body.url, expiresAt, mime: typeof body.mime === "string" ? body.mime : null, playable: body.playable !== false };
}

// ------------------------------------------------------------------------------------- Timing maths

/** The index of the last start at or before `t` (binary search over ascending starts); -1 before the first. */
export function activeIndex(starts: number[], t: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The speakers in order of first speech. */
export function speakerOrder(turns: SpeakerTurn[]): string[] {
  return [...new Set(turns.map((t) => t.speaker))];
}

/** [start, end, speaker index in order of first speech], adjacent turns of one speaker merged. */
export function speakerSpans(turns: SpeakerTurn[]): Array<[number, number, number]> {
  const order = new Map<string, number>();
  const spans: Array<[number, number, number]> = [];
  for (const t of [...turns].sort((a, b) => a.startSec - b.startSec)) {
    if (!order.has(t.speaker)) order.set(t.speaker, order.size);
    const index = order.get(t.speaker)!;
    const end = Math.max(t.startSec, t.endSec);
    const last = spans[spans.length - 1];
    if (last && last[2] === index) last[1] = Math.max(last[1], end);
    else spans.push([t.startSec, end, index]);
  }
  return spans;
}

/** The scrubber's length: Callyzer's talk time, the file's length or the last word, whichever is longest. */
export const recordingLength = (durationSec: number, recordingSec: number | null | undefined, turns: SpeakerTurn[]): number =>
  Math.max(durationSec || 0, Number(recordingSec) || 0, turns.reduce((end, t) => Math.max(end, t.endSec), 0));

/** "1 minute 23 seconds of 4 minutes 12 seconds" for the slider's aria-valuetext. */
export const scrubberValueText = (current: number, total: number): string => `${spokenTime(current)} of ${spokenTime(total)}`;

/** Lane colours: DNY bottle, the other side sienna, risks signal, facts and questions slate, decisions ink. */
export type TickTone = "dny" | "other" | "risk" | "info" | "decision";

export interface EvidenceTick {
  id: string;
  sec: number;
  tone: TickTone;
  label: string;
  quote: string | null;
  /** `sec` is the refined second the quote is said (not the turn's marker). */
  refined: boolean;
}

export interface TickGroup {
  /** Pixels from the left of the track. */
  x: number;
  /** The earliest tick's second. */
  sec: number;
  tone: TickTone | "mixed";
  ticks: EvidenceTick[];
}

/** Ticks closer than this are one marker with a count. */
export const TICK_MERGE_PX = 24;

type TickItem = Pick<ActionItemRow, "id" | "title" | "owed_by" | "status" | "evidence_ts_sec" | "evidence_quote">;
type TickView = Pick<SheetView, "decisions" | "key_facts" | "risks" | "open_questions">;

/** Every quote with a known second: open and done items by lane, then decisions, facts, risks, questions. */
export function collectTicks(view: TickView | null, items: TickItem[], refined: Record<string, number[]> = {}): EvidenceTick[] {
  const ticks: EvidenceTick[] = [];
  for (const item of items) {
    if (item.status === "dropped" || item.status === "superseded" || item.evidence_ts_sec == null) continue;
    const tone: TickTone = item.owed_by === "client" ? "other" : item.owed_by === "unclear" ? "info" : "dny";
    ticks.push({ id: item.id, sec: item.evidence_ts_sec, tone, label: item.title, quote: item.evidence_quote, refined: false });
  }
  if (view) {
    const entries: Array<[TickTone, { id: string; evidence: Array<{ timestamp: string; quote: string }> }, string]> = [
      ...view.decisions.map((d): [TickTone, typeof d, string] => ["decision", d, d.statement]),
      ...view.key_facts.map((f): [TickTone, typeof f, string] => ["info", f, f.fact]),
      ...view.risks.map((r): [TickTone, typeof r, string] => ["risk", r, r.description]),
      ...view.open_questions.map((q): [TickTone, typeof q, string] => ["info", q, q.question]),
    ];
    for (const [tone, entry, label] of entries) {
      const first = entry.evidence[0];
      if (!first) continue;
      const fine = refined[entry.id]?.[0];
      const sec = typeof fine === "number" && Number.isFinite(fine) ? fine : secondsFrom(first.timestamp);
      if (sec == null) continue;
      ticks.push({ id: entry.id, sec, tone, label, quote: first.quote, refined: typeof fine === "number" && Number.isFinite(fine) });
    }
  }
  return ticks.sort((a, b) => a.sec - b.sec);
}

/** Places ticks on a track `widthPx` wide and merges the ones closer than TICK_MERGE_PX to a group's first. */
export function mergeTicks(ticks: EvidenceTick[], widthPx: number, durationSec: number): TickGroup[] {
  if (!(widthPx > 0) || !(durationSec > 0)) return [];
  const groups: Array<{ x0: number; xs: number[]; ticks: EvidenceTick[] }> = [];
  for (const tick of [...ticks].filter((t) => t.sec >= 0).sort((a, b) => a.sec - b.sec)) {
    const x = (Math.min(tick.sec, durationSec) / durationSec) * widthPx;
    const last = groups[groups.length - 1];
    if (last && x - last.x0 < TICK_MERGE_PX) {
      last.ticks.push(tick);
      last.xs.push(x);
    } else groups.push({ x0: x, xs: [x], ticks: [tick] });
  }
  return groups.map((g) => ({
    x: g.xs.reduce((a, b) => a + b, 0) / g.xs.length,
    sec: g.ticks[0].sec,
    tone: g.ticks.every((t) => t.tone === g.ticks[0].tone) ? g.ticks[0].tone : "mixed",
    ticks: g.ticks,
  }));
}

export function evidenceTicks(view: TickView | null, items: TickItem[], widthPx: number, durationSec: number, refined: Record<string, number[]> = {}): TickGroup[] {
  return mergeTicks(collectTicks(view, items, refined), widthPx, durationSec);
}
