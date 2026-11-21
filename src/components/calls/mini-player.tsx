"use client";

import { Pause, Play, X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { formatTimestamp } from "@/lib/format";
import { IconButton } from "@/components/ui/button";
import { useRecording } from "./recording-provider";

// A 56 px bar (in BottomDock) that keeps the recording in reach once the player card has scrolled away or
// is gone. A 3 px progress line on top, play and pause, what is playing ("Playing 1:23 · ‘quote…’" after a
// tap on a quote, until the next seek), and close, which pauses and hides it until the next play.

export function MiniPlayer() {
  const { subscribe, playing, toggle, caption, meta, closeMini } = useRecording();
  const lineRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const length = meta?.lengthSec ?? 0;

  useEffect(
    () =>
      subscribe((sec) => {
        if (lineRef.current) lineRef.current.style.transform = `scaleX(${length > 0 ? Math.min(1, sec / length) : 0})`;
        if (timeRef.current) timeRef.current.textContent = formatTimestamp(sec);
      }),
    [subscribe, length],
  );

  return (
    <div role="region" aria-label="Recording" className="relative flex h-14 items-center gap-2 border-t border-hairline bg-canvas/95 pr-1 pl-3 backdrop-blur">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-hairline">
        <span ref={lineRef} className="block h-full origin-left bg-ink" style={{ transform: "scaleX(0)" }} />
      </span>
      <button type="button" onClick={toggle} aria-label={playing ? "Pause the recording" : "Play the recording"} className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-sheet">
        {playing ? <Pause size={16} weight="fill" aria-hidden="true" /> : <Play size={16} weight="fill" aria-hidden="true" className="translate-x-px" />}
      </button>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[13px] font-medium text-ink">{caption ? `Playing ${caption}` : (meta?.title ?? "Call recording")}</p>
        <p className="truncate font-mono text-[12px] text-ink-3 tnum">
          <span ref={timeRef}>0:00</span> / {formatTimestamp(length)}
          {meta?.artist && <span className="font-sans"> · {meta.artist}</span>}
        </p>
      </div>
      <IconButton label="Close the player" onClick={closeMini}>
        <X size={18} />
      </IconButton>
    </div>
  );
}
