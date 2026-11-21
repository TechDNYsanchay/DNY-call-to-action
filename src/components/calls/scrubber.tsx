"use client";

import clsx from "clsx";
import { Play } from "@phosphor-icons/react";
import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatTimestamp } from "@/lib/format";
import { spokenTime } from "@/lib/ui/evidence";
import { type EvidenceTick, mergeTicks, scrubberValueText, type TickGroup, type TickTone } from "@/lib/ui/player";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { useRecording } from "./recording-provider";

// The scrubber in three rows: who speaks when (a strip of speaker spans, computed on the server), the
// slider itself (a 3 px ink line moved every frame without React state), and the evidence markers on a row
// of their own, so a marker never swallows a drag. Markers closer than 24 px merge into one with a count;
// a merged marker, and every marker on a touch screen, opens the list of its quotes instead of playing.

export type SpeakerTone = "dny" | "other" | "a" | "b";

const SPEAKER_TONES: Record<SpeakerTone, string> = { dny: "bg-bottle", other: "bg-sienna", a: "bg-ink-3", b: "bg-strong" };
const TICK_TONES: Record<TickTone | "mixed", string> = { dny: "bg-bottle", other: "bg-sienna", risk: "bg-signal", info: "bg-slate", decision: "bg-ink", mixed: "bg-ink-2" };
const TICK_TEXT: Record<TickTone | "mixed", string> = { dny: "text-bottle", other: "text-sienna", risk: "text-signal", info: "text-slate", decision: "text-ink", mixed: "text-ink-2" };

const STEP = 5;
const BIG_STEP = 15;

const COARSE = "(pointer: coarse)";
const watchCoarse = (onChange: () => void) => {
  const query = window.matchMedia(COARSE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

export function Scrubber({ lengthSec, spans, speakerTones, ticks }: { lengthSec: number; spans: Array<[number, number, number]>; speakerTones: SpeakerTone[]; ticks: EvidenceTick[] }) {
  const { subscribe, seek, toggle, canPlay } = useRecording();
  const trackRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const [width, setWidth] = useState(0);
  // Touch screens open a marker's list instead of playing it; the server renders the mouse version.
  const coarse = useSyncExternalStore(watchCoarse, () => window.matchMedia(COARSE).matches, () => false);
  const length = Math.max(1, lengthSec);

  /** Moves the line, the thumb and the slider's values; never React state. */
  const paint = useCallback(
    (sec: number) => {
      const at = Math.min(length, Math.max(0, sec));
      const share = at / length;
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${share})`;
      if (thumbRef.current) thumbRef.current.style.left = `${share * 100}%`;
      const track = trackRef.current;
      if (track) {
        track.setAttribute("aria-valuenow", String(Math.floor(at)));
        track.setAttribute("aria-valuetext", scrubberValueText(at, length));
      }
    },
    [length],
  );

  useEffect(
    () =>
      subscribe((sec) => {
        if (dragging.current === null) paint(sec);
      }),
    [subscribe, paint],
  );

  useEffect(() => {
    const row = markersRef.current;
    if (!row) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  const secAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return (Math.min(rect.width, Math.max(0, clientX - rect.left)) / rect.width) * length;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!canPlay || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = secAt(e.clientX);
    paint(dragging.current);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current === null) return;
    dragging.current = secAt(e.clientX);
    paint(dragging.current);
  };
  const onPointerUp = () => {
    if (dragging.current === null) return;
    const at = dragging.current;
    dragging.current = null;
    seek(at);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!canPlay) return;
    const now = Number(trackRef.current?.getAttribute("aria-valuenow") ?? 0);
    const step = e.shiftKey ? BIG_STEP : STEP;
    let to: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") to = now - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") to = now + step;
    else if (e.key === "PageDown") to = now - BIG_STEP;
    else if (e.key === "PageUp") to = now + BIG_STEP;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = length;
    else if (e.key === " " || e.key === "k" || e.key === "K") {
      e.preventDefault();
      toggle();
      return;
    }
    if (to === null) return;
    e.preventDefault();
    seek(Math.min(length, Math.max(0, to)));
  };

  const groups = mergeTicks(ticks, width, length);

  return (
    <div className="flex flex-col gap-1.5">
      {spans.length > 0 && (
        <div className="relative h-1.5 overflow-hidden rounded-full bg-inset" aria-hidden="true" title="Who speaks when">
          {spans.map(([from, to, speaker], i) => (
            <span
              key={i}
              className={clsx("absolute inset-y-0", SPEAKER_TONES[speakerTones[speaker] ?? (speaker % 2 ? "b" : "a")])}
              style={{ left: `${(Math.min(from, length) / length) * 100}%`, width: `${(Math.max(0, Math.min(to, length) - from) / length) * 100}%` }}
            />
          ))}
        </div>
      )}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={canPlay ? 0 : -1}
        aria-label="Position in the recording"
        aria-valuemin={0}
        aria-valuemax={Math.floor(length)}
        aria-valuenow={0}
        aria-valuetext={scrubberValueText(0, length)}
        aria-disabled={!canPlay || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={clsx("group relative h-6 touch-none select-none", canPlay ? "cursor-pointer" : "cursor-default opacity-60")}
      >
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-hairline" />
        <div ref={progressRef} className="absolute inset-x-0 top-1/2 h-[3px] origin-left -translate-y-1/2 rounded-full bg-ink" style={{ transform: "scaleX(0)" }} />
        <div ref={thumbRef} className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink opacity-0 shadow-card transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" style={{ left: "0%" }} />
      </div>
      <div ref={markersRef} className={clsx("relative h-4", !ticks.length && "hidden")} role="group" aria-label="Moments from the sheet">
        {groups.map((group) => (
          <TickMarker key={group.ticks[0].id} group={group} asList={coarse || group.ticks.length > 1} disabled={!canPlay} />
        ))}
      </div>
    </div>
  );
}

function TickMarker({ group, asList, disabled }: { group: TickGroup; asList: boolean; disabled: boolean }) {
  const { seekToQuote } = useRecording();
  const playTick = (tick: EvidenceTick) => seekToQuote(tick.sec, tick.quote, tick.refined ? tick.sec : null, { play: true });
  const first = group.ticks[0];
  const count = group.ticks.length;
  const mark = (
    <span className="flex h-full items-center justify-center">
      {count > 1 ? (
        <span className={clsx("inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 font-mono text-[10px] leading-none font-medium text-sheet tnum", TICK_TONES[group.tone])}>{count}</span>
      ) : (
        <span className={clsx("h-2.5 w-[3px] rounded-full", TICK_TONES[group.tone])} />
      )}
    </span>
  );
  const className = "absolute top-0 flex h-4 w-6 -translate-x-1/2 items-stretch justify-center rounded-[4px] transition-colors duration-150 hover:bg-raised disabled:pointer-events-none";
  if (!asList)
    return (
      <button type="button" disabled={disabled} onClick={() => playTick(first)} aria-label={`Play from ${spokenTime(Math.max(0, first.sec - 1))}: ${first.label}`} title={`${formatTimestamp(first.sec)} · ${first.label}`} className={className} style={{ left: group.x }}>
        {mark}
      </button>
    );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} aria-label={count > 1 ? `${count} moments near ${spokenTime(first.sec)}` : `Moment at ${spokenTime(first.sec)}: ${first.label}`} className={className} style={{ left: group.x }}>
          {mark}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-[min(92vw,340px)] p-1.5">
        <ul className="flex flex-col">
          {group.ticks.map((tick) => (
            <li key={tick.id}>
              <PopoverClose asChild>
                <button type="button" onClick={() => playTick(tick)} className="flex min-h-11 w-full items-start gap-2.5 rounded-[6px] px-2 py-2 text-left hover:bg-raised lg:min-h-9">
                  <span className={clsx("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-inset", TICK_TEXT[tick.tone])}>
                    <Play size={10} weight="fill" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-[18px] text-ink">{tick.label}</span>
                    {tick.quote && <span className="block truncate font-serif text-[13px] text-ink-2 italic">“{tick.quote}”</span>}
                  </span>
                  <span className="shrink-0 pt-0.5 font-mono text-[12px] text-ink-3 tnum">{formatTimestamp(tick.sec)}</span>
                </button>
              </PopoverClose>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
