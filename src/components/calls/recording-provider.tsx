"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { refineQuoteSecond } from "@/lib/calls/seek";
import { formatTimestamp } from "@/lib/format";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import { type Availability, canPlayState, initialPlayerState, type LinkResult, PLAYBACK_RATES, type PlayerEffect, type PlayerEvent, playerReducer, type PlayerState, readLinkReply } from "@/lib/ui/player";

// The call page's one <audio> element and everything that drives it. It lives in the call's layout, so
// it survives every refresh of the page below it (an item ticked, a Realtime update, the sheet landing)
// and a page error. Every media event, timer tick and link reply goes through playerReducer (pure, tested
// in src/lib/ui/player.test.ts); the effects it asks for run at once, in the same call, so a play()
// started by a tap is still inside the tap (iOS refuses play() outside a gesture). Positions are never
// React state: the scrubber, the transcript and the mini-player subscribe and move the DOM themselves.

export interface RecordingMeta {
  /** For the lock screen and the mini-player: the headline, else the title, else "Call on {line}". */
  title: string;
  /** The line's display name. */
  artist: string;
  /** The scrubber's length (recordingLength), known before the metadata loads. */
  lengthSec: number;
}

export interface SeekOptions {
  play?: boolean;
  /**
   * Shown by the mini-player ("Playing 1:23 · ‘quote…’") when playback starts from a quote. Every other seek
   * (the scrubber, the keys, the lock screen's 10 s jumps, a transcript time) clears it.
   */
  caption?: string | null;
}

export interface RecordingApi {
  state: PlayerState;
  canPlay: boolean;
  playing: boolean;
  rate: number;
  /** Played at least once since the page opened: the mini-player appears only after a first play. */
  started: boolean;
  caption: string | null;
  meta: RecordingMeta | null;
  /** The inline player card is on screen (the mini-player stays hidden while it is). */
  inlineVisible: boolean;
  /** The mini-player was closed; the next play brings it back. */
  miniClosed: boolean;
  toggle(): void;
  play(): void;
  pause(): void;
  seek(sec: number, opts?: SeekOptions): void;
  /** Plays from a second before the quote: the refined second when known, else found in the turns. */
  seekToQuote(markerSec: number, quote: string | null, refinedSec?: number | null, opts?: { play?: boolean }): void;
  setTurns(turns: SpeakerTurn[]): void;
  /** Called with the position on every frame while playing and on every seek; returns the unsubscribe. */
  subscribe(cb: (sec: number) => void): () => void;
  currentTime(): number;
  setRate(rate: number): void;
  /** The page's word on the recording, and why the call was deleted when it was (phone_calls.skip_code). */
  setAvailability(availability: Availability, skipCode?: string | null): void;
  setMeta(meta: RecordingMeta): void;
  setInlineVisible(visible: boolean): void;
  closeMini(): void;
  retry(): void;
  /** A one-minute download link (the route signs it with the call's file name). */
  downloadLink(): Promise<LinkResult>;
}

const RecordingContext = createContext<RecordingApi | null>(null);

/** The provider on a call page, else null: evidence pills behave as on a meeting page. */
export function useRecordingOptional(): RecordingApi | null {
  return useContext(RecordingContext);
}

export function useRecording(): RecordingApi {
  const api = useContext(RecordingContext);
  if (!api) throw new Error("useRecording outside a call page");
  return api;
}

const RATE_KEY = "cta-call-rate";
const TICK_MS = 60_000;
/** A link with less than this left is not played; a fresh one is fetched first. */
const LINK_SAFE_MS = 30_000;
/** A media error this soon after a tap counts as playing: the reloaded source resumes. */
const PLAY_GRACE_MS = 10_000;

function savedRate(): number {
  try {
    const value = Number(window.localStorage.getItem(RATE_KEY));
    return (PLAYBACK_RATES as readonly number[]).includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

async function requestLink(callId: string, download: boolean): Promise<LinkResult> {
  try {
    const response = await fetch(`/api/calls/${callId}/audio-url${download ? "?download=1" : ""}`, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } });
    const contentType = response.headers.get("content-type");
    const body = contentType?.toLowerCase().includes("application/json") ? await response.json().catch(() => null) : null;
    return readLinkReply({ status: response.status, redirected: response.redirected, contentType, body });
  } catch {
    return { ok: false, failure: { kind: "network" } };
  }
}

export function RecordingProvider({ callId, children }: { callId: string; children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The reducer's state twice: as React state for rendering, and in a ref for the handlers, which must see
  // the latest state inside the same tap (send updates both at once).
  const [state, setState] = useState<PlayerState>(initialPlayerState);
  const stateRef = useRef<PlayerState>(state);
  const [rate, setRateState] = useState(1);
  const [started, setStarted] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);
  const [meta, setMetaState] = useState<RecordingMeta | null>(null);
  const [inlineVisible, setInlineVisibleState] = useState(true);
  const [miniClosed, setMiniClosed] = useState(false);
  const turnsRef = useRef<SpeakerTurn[]>([]);
  /** When a tap last asked to play: a media error right after it (an expired link) resumes once reloaded. */
  const playAskedAt = useRef(0);
  const listeners = useRef(new Set<(sec: number) => void>());
  const mounted = useRef(true);

  const emit = useCallback(() => {
    const t = audioRef.current?.currentTime ?? 0;
    for (const cb of listeners.current) cb(t);
  }, []);

  // `send` and `run` call each other (a link reply is an event; a fetch is an effect), through this ref.
  const sendRef = useRef<(event: PlayerEvent) => void>(() => {});

  const run = useCallback(
    (effects: PlayerEffect[]) => {
      const audio = audioRef.current;
      if (!audio) return;
      for (const effect of effects) {
        switch (effect.kind) {
          case "load":
            audio.src = effect.url;
            audio.load();
            break;
          case "clear":
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
            emit();
            break;
          case "seek":
            try {
              audio.currentTime = effect.at;
            } catch {
              // A source that cannot seek yet keeps its place; the next loadedmetadata applies it.
            }
            emit();
            break;
          case "play":
            // Refused without a tap (iOS after a reload): "Tap to resume". An interrupted play is not a refusal.
            void audio.play().catch((error: unknown) => {
              if (error instanceof DOMException && error.name === "NotAllowedError") sendRef.current({ type: "blocked" });
            });
            break;
          case "fetch": {
            const seq = stateRef.current.fetchSeq;
            void requestLink(callId, false).then((result) => {
              // A reply for an older request (the call went away meanwhile, or a newer one was asked) is dropped.
              if (!mounted.current || stateRef.current.fetchSeq !== seq) return;
              sendRef.current(result.ok ? { type: "link", url: result.url, expiresAt: result.expiresAt } : { type: "link_failed", failure: result.failure, now: Date.now() });
            });
            break;
          }
        }
      }
    },
    [callId, emit],
  );

  const send = useCallback(
    (event: PlayerEvent) => {
      const next = playerReducer(stateRef.current, event);
      stateRef.current = next;
      setState(next);
      if (next.effects.length) run(next.effects);
    },
    [run],
  );
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Media events in, a frame loop while playing for the subscribers, and the link's timers.
  useEffect(() => {
    mounted.current = true;
    const audio = audioRef.current;
    if (!audio) return;
    const initial = savedRate();
    audio.defaultPlaybackRate = initial;
    audio.playbackRate = initial;
    const rateTimer = window.setTimeout(() => setRateState(initial), 0);
    let frame = 0;
    const loop = () => {
      emit();
      frame = window.requestAnimationFrame(loop);
    };
    const onLoaded = () => {
      sendRef.current({ type: "loaded" });
      emit();
    };
    const onPlaying = () => {
      sendRef.current({ type: "playing" });
      setStarted(true);
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(loop);
    };
    const onPause = () => {
      window.cancelAnimationFrame(frame);
      sendRef.current({ type: "paused", position: audio.currentTime, ended: audio.ended });
      emit();
    };
    const onError = () => {
      window.cancelAnimationFrame(frame);
      const asked = Date.now() - playAskedAt.current < PLAY_GRACE_MS;
      sendRef.current({ type: "media_error", position: audio.currentTime || stateRef.current.lastPosition, wasPlaying: stateRef.current.status === "playing" || asked });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sendRef.current({ type: "visible", now: Date.now() });
    };
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);
    audio.addEventListener("seeked", emit);
    audio.addEventListener("timeupdate", emit);
    document.addEventListener("visibilitychange", onVisible);
    const tick = window.setInterval(() => sendRef.current({ type: "tick", now: Date.now() }), TICK_MS);
    return () => {
      mounted.current = false;
      window.clearTimeout(rateTimer);
      window.clearInterval(tick);
      window.cancelAnimationFrame(frame);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("seeked", emit);
      audio.removeEventListener("timeupdate", emit);
      document.removeEventListener("visibilitychange", onVisible);
      audio.pause();
    };
  }, [emit]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    const s = stateRef.current;
    if (!audio || s.availability !== "stored") return;
    setMiniClosed(false);
    playAskedAt.current = Date.now();
    if (s.expiresAt !== null && s.expiresAt - Date.now() < LINK_SAFE_MS) {
      // A link that has run out (a tab left in the background for an hour): fetch a fresh one and play it.
      send({ type: "visible", now: Date.now() });
      send({ type: "want_play" });
      return;
    }
    if (s.status === "error" || !s.url) {
      // No source yet (or a failed one): play as soon as the link has loaded.
      send({ type: "want_play" });
      return;
    }
    // Inside the tap, as iOS requires; a held seek is applied when the metadata arrives.
    void audio.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "NotAllowedError") send({ type: "blocked" });
    });
  }, [send]);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const seek = useCallback(
    (sec: number, opts: SeekOptions = {}) => {
      if (stateRef.current.availability !== "stored") return;
      send({ type: "seek", position: Math.max(0, sec) });
      setCaption(opts.caption ?? null);
      if (opts.play) play();
    },
    [play, send],
  );

  const toggle = useCallback(() => (stateRef.current.status === "playing" ? pause() : play()), [pause, play]);
  const seekToQuote = useCallback(
    (markerSec: number, quote: string | null, refinedSec?: number | null, opts: { play?: boolean } = {}) => {
      const at = refinedSec ?? refineQuoteSecond(markerSec, quote, turnsRef.current);
      const words = quote?.trim() ?? "";
      const short = words.length > 60 ? `${words.slice(0, 59).trimEnd()}…` : words;
      seek(Math.max(0, at - 1), { play: opts.play ?? true, caption: short ? `${formatTimestamp(at)} · ‘${short}’` : null });
    },
    [seek],
  );
  const setTurns = useCallback((turns: SpeakerTurn[]) => {
    turnsRef.current = turns;
  }, []);
  const subscribe = useCallback((cb: (sec: number) => void) => {
    listeners.current.add(cb);
    cb(audioRef.current?.currentTime ?? 0);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);
  const currentTime = useCallback(() => audioRef.current?.currentTime ?? stateRef.current.lastPosition, []);
  const setRate = useCallback((next: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.defaultPlaybackRate = next;
      audio.playbackRate = next;
    }
    setRateState(next);
    try {
      window.localStorage.setItem(RATE_KEY, String(next));
    } catch {
      // A private window keeps the speed for this page only.
    }
  }, []);
  const setAvailability = useCallback(
    (availability: Availability, skipCode: string | null = null) => {
      const s = stateRef.current;
      if (s.availability !== availability || (availability !== "stored" && s.skipCode !== skipCode) || s.status === "idle") send({ type: "availability", availability, skipCode });
    },
    [send],
  );
  const setMeta = useCallback((next: RecordingMeta) => setMetaState((prev) => (prev?.title === next.title && prev?.artist === next.artist && prev?.lengthSec === next.lengthSec ? prev : next)), []);
  const setInlineVisible = useCallback((visible: boolean) => setInlineVisibleState(visible), []);
  const closeMini = useCallback(() => {
    audioRef.current?.pause();
    setMiniClosed(true);
  }, []);
  const retry = useCallback(() => send({ type: "retry" }), [send]);
  const downloadLink = useCallback(() => requestLink(callId, true), [callId]);

  const api = useMemo<RecordingApi>(
    () => ({
      state,
      canPlay: canPlayState(state),
      playing: state.status === "playing",
      rate,
      started,
      caption,
      meta,
      inlineVisible,
      miniClosed,
      play,
      pause,
      toggle,
      seek,
      seekToQuote,
      setTurns,
      subscribe,
      currentTime,
      setRate,
      setAvailability,
      setMeta,
      setInlineVisible,
      closeMini,
      retry,
      downloadLink,
    }),
    [state, rate, started, caption, meta, inlineVisible, miniClosed, play, pause, toggle, seek, seekToQuote, setTurns, subscribe, currentTime, setRate, setAvailability, setMeta, setInlineVisible, closeMini, retry, downloadLink],
  );

  // The lock screen and headphone buttons: play, pause and 10 s jumps, while this page is open.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !meta) return;
    const session = navigator.mediaSession;
    try {
      session.metadata = new MediaMetadata({ title: meta.title, artist: meta.artist, album: "Call to Action" });
      session.setActionHandler("play", () => play());
      session.setActionHandler("pause", () => pause());
      session.setActionHandler("seekbackward", () => seek(Math.max(0, (audioRef.current?.currentTime ?? 0) - 10)));
      session.setActionHandler("seekforward", () => seek((audioRef.current?.currentTime ?? 0) + 10));
    } catch {
      // Older browsers without some actions: the page's own controls still work.
    }
    return () => {
      try {
        session.metadata = null;
        for (const action of ["play", "pause", "seekbackward", "seekforward"] as const) session.setActionHandler(action, null);
      } catch {
        // Nothing to undo.
      }
    };
  }, [meta, play, pause, seek]);

  return (
    <RecordingContext value={api}>
      {/* A phone call's recording; its text is the transcript on the same page. */}
      <audio ref={audioRef} preload="metadata" className="hidden" />
      {children}
    </RecordingContext>
  );
}
