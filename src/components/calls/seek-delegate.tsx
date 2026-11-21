"use client";

import type { MouseEvent, ReactNode } from "react";
import { useRecordingOptional } from "./recording-provider";

// One click handler for the whole call article: every [data-seek] inside it (a transcript time, a quote's
// timestamp) plays from about a second before its words, with no listener per element. A click that ends a
// text selection is left alone, so quotes stay easy to copy. Quotes carry data-quote (the recording is
// searched for the words) and data-refined when the save already found the second.

export function SeekDelegate({ children, className }: { children: ReactNode; className?: string }) {
  const recording = useRecordingOptional();
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (!recording?.canPlay) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-seek]");
    if (!target || !e.currentTarget.contains(target)) return;
    if (window.getSelection()?.toString()) return;
    const sec = Number(target.dataset.seek);
    if (!Number.isFinite(sec)) return;
    const quote = target.dataset.quote ?? null;
    if (quote) recording.seekToQuote(sec, quote, target.dataset.refined ? sec : null, { play: true });
    else recording.seek(Math.max(0, sec - 1), { play: true, caption: null });
  };
  return (
    <article className={className} onClick={onClick}>
      {children}
    </article>
  );
}
