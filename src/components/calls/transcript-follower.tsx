"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import { activeIndex } from "@/lib/ui/player";
import { usePlayerKeys } from "./recording-player";
import { useRecordingOptional } from "./recording-provider";

// Keeps the server-rendered transcript in step with the recording: the line being spoken gets data-active
// (set on the element, no React state), and the page follows it only while the transcript is on screen and
// nobody has scrolled for 5 s; never under reduced motion. Hands the turns to the player, so a quote is found
// in the words when the sheet has no refined second. ↑/↓ move between the line times (one is tabbable).
// `deepLinkSec` (?t=83) parks the player a second before it, without playing, and brings that line into view.

const FOLLOW_AFTER_SCROLL_MS = 5_000;

function highlight(ref: { current: HTMLElement | null }, line: HTMLElement | null) {
  if (ref.current === line) return;
  ref.current?.removeAttribute("data-active");
  line?.setAttribute("data-active", "");
  ref.current = line;
}

export function TranscriptFollower({ turns, deepLinkSec, children }: { turns: SpeakerTurn[]; deepLinkSec?: number | null; children: ReactNode }) {
  const recording = useRecordingOptional();
  const setTurns = recording?.setTurns;
  const subscribe = recording?.subscribe;
  const seek = recording?.seek;
  const rootRef = useRef<HTMLDivElement>(null);
  /** The one highlighted line, shared by the follower and the deep link. */
  const activeRef = useRef<HTMLElement | null>(null);
  const keys = usePlayerKeys();

  useEffect(() => {
    setTurns?.(turns);
  }, [turns, setTurns]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !subscribe) return;
    const lines = Array.from(root.querySelectorAll<HTMLElement>("li[data-start]"));
    const starts = lines.map((li) => Number(li.dataset.start));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let active = -1;
    let onScreen = false;
    let lastUserScroll = 0;
    const seen = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
    });
    seen.observe(root);
    const userScrolled = () => {
      lastUserScroll = Date.now();
    };
    const userKey = (e: globalThis.KeyboardEvent) => {
      if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(e.key)) lastUserScroll = Date.now();
    };
    window.addEventListener("wheel", userScrolled, { passive: true });
    window.addEventListener("touchmove", userScrolled, { passive: true });
    window.addEventListener("keydown", userKey);
    const unsubscribe = subscribe((sec) => {
      const index = activeIndex(starts, sec);
      if (index === active) return;
      active = index;
      const line = lines[index] ?? null;
      highlight(activeRef, line);
      if (line && !reduce.matches && onScreen && Date.now() - lastUserScroll > FOLLOW_AFTER_SCROLL_MS) line.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => {
      unsubscribe();
      seen.disconnect();
      window.removeEventListener("wheel", userScrolled);
      window.removeEventListener("touchmove", userScrolled);
      window.removeEventListener("keydown", userKey);
      highlight(activeRef, null);
    };
  }, [subscribe, turns]);

  // ?t=83 from My actions or a client page: the place is set, playback waits for a tap.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || deepLinkSec == null || !Number.isFinite(deepLinkSec)) return;
    seek?.(Math.max(0, deepLinkSec - 1), { caption: null });
    const lines = Array.from(root.querySelectorAll<HTMLElement>("li[data-start]"));
    const line = lines[activeIndex(lines.map((li) => Number(li.dataset.start)), deepLinkSec)];
    if (!line) return;
    highlight(activeRef, line);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    line.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [deepLinkSec, seek]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && target.matches("button[data-seek]")) {
      const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-seek]"));
      const next = buttons[buttons.indexOf(target as HTMLButtonElement) + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      for (const b of buttons) b.tabIndex = b === next ? 0 : -1;
      next.focus();
      return;
    }
    keys(e);
  };

  return (
    <div ref={rootRef} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
