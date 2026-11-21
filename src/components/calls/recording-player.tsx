"use client";

import clsx from "clsx";
import { ArrowClockwise, DownloadSimple, Pause, Play } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { formatTimestamp } from "@/lib/format";
import { type Availability, deletedText, type EvidenceTick, PLAYBACK_RATES, playerMessage } from "@/lib/ui/player";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useRecording, useRecordingOptional } from "./recording-provider";
import { Scrubber, type SpeakerTone } from "./scrubber";

// The player card on a call page: a 44 px play button, the time, the speed, Download, and the scrubber. On
// screens at least 768 × 640 it sticks to the top while the sheet scrolls under it, and publishes its height
// as --player-h so links into the sheet and the transcript land below it. It tells the provider whether it is
// on screen: where it does not stick, the mini-player takes over once it has scrolled away (or is gone).

const STICKY = "(min-width: 768px) and (min-height: 640px)";
const STEP = 5;
const BIG_STEP = 15;

/** Space or K plays and pauses; arrows move 5 s, with Shift 15 s. Buttons and the slider keep their own keys. */
export function usePlayerKeys() {
  const recording = useRecordingOptional();
  return (e: KeyboardEvent<HTMLElement>) => {
    if (!recording?.canPlay || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, summary, [contenteditable], [role='slider'], [role='menu'], [role='menuitem'], [role='dialog']")) return;
    const onButton = Boolean(target.closest("button, a"));
    if (e.key === "k" || e.key === "K" || (e.key === " " && !onButton)) {
      e.preventDefault();
      recording.toggle();
      return;
    }
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !onButton) {
      e.preventDefault();
      const step = (e.shiftKey ? BIG_STEP : STEP) * (e.key === "ArrowLeft" ? -1 : 1);
      recording.seek(Math.max(0, recording.currentTime() + step));
    }
  };
}

/** Download: a one-minute link, asked for at the tap, so a stale page never holds a working link. */
export function DownloadRecordingButton({ className, compact }: { className?: string; compact?: boolean }) {
  const recording = useRecording();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      className={className}
      aria-label={compact ? "Download the recording" : undefined}
      title={compact ? "Download the recording" : undefined}
      onClick={async () => {
        setPending(true);
        const result = await recording.downloadLink();
        setPending(false);
        if (result.ok) window.location.assign(result.url);
        else if (result.failure.kind === "signed_out") toast({ message: "You were signed out. Reload the page.", tone: "signal" });
        else if (result.failure.kind === "denied") toast({ message: result.failure.reason === "not_work" ? deletedText(recording.state.skipCode) : result.failure.reason === "deleted" ? "The recording was deleted after 30 days" : "The recording opens once the call is confirmed as a client or vendor call", tone: "signal" });
        else toast({ message: "Couldn't get the recording. Try again.", tone: "signal" });
      }}
    >
      <DownloadSimple size={16} aria-hidden="true" />
      {!compact && "Download"}
    </Button>
  );
}

export function RecordingPlayer({
  availability,
  skipCode = null,
  lengthSec,
  spans,
  speakerTones,
  ticks,
  className,
}: {
  /** The page's word on the recording, so a deleted or unplayable one says so from the first paint. */
  availability: Availability;
  /** Why a deleted call was deleted (phone_calls.skip_code), for its words from the first paint. */
  skipCode?: string | null;
  lengthSec: number;
  spans: Array<[number, number, number]>;
  speakerTones: SpeakerTone[];
  ticks: EvidenceTick[];
  className?: string;
}) {
  const recording = useRecording();
  const { subscribe, setInlineVisible, state, canPlay, playing, rate, setRate, toggle, retry } = recording;
  const cardRef = useRef<HTMLElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const keys = usePlayerKeys();
  const length = Math.max(0, lengthSec);
  // Unavailable by the page's word (rendered on the server too), or by the player's (a refused link, an error).
  const stopped =
    availability !== "stored"
      ? { status: "unavailable" as const, reason: availability, skipCode: skipCode ?? state.skipCode }
      : state.status === "unavailable" || state.status === "error"
        ? { status: state.status, reason: state.reason, skipCode: state.skipCode }
        : null;
  const message = stopped ? playerMessage(stopped) : null;

  useEffect(
    () =>
      subscribe((sec) => {
        if (timeRef.current) timeRef.current.textContent = formatTimestamp(Math.min(sec, length || sec));
      }),
    [subscribe, length],
  );

  // On screen or not, for the mini-player; and the sticky height for the scroll targets.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const visibility = new IntersectionObserver(([entry]) => setInlineVisible(entry.isIntersecting), { threshold: 0 });
    visibility.observe(card);
    const root = document.documentElement;
    const sticky = window.matchMedia(STICKY);
    const publish = () => {
      if (sticky.matches && card.classList.contains("player-sticky")) root.style.setProperty("--player-h", `${Math.round(card.getBoundingClientRect().height)}px`);
      else root.style.removeProperty("--player-h");
    };
    const size = new ResizeObserver(publish);
    size.observe(card);
    sticky.addEventListener("change", publish);
    return () => {
      visibility.disconnect();
      size.disconnect();
      sticky.removeEventListener("change", publish);
      root.style.removeProperty("--player-h");
      // Gone (a page error replaced it): the dock, or the error page's own button, keeps the audio in reach.
      setInlineVisible(false);
    };
  }, [setInlineVisible]);

  return (
    <section ref={cardRef} aria-label="Recording" onKeyDown={keys} className={clsx("card px-3 py-3 sm:px-4", availability === "stored" && "player-sticky", className)}>
      {stopped ? (
        <div className="flex min-h-11 flex-wrap items-center gap-3">
          <p className={clsx("min-w-0 flex-1 text-[14px] leading-[20px]", stopped.status === "error" ? "text-signal" : "text-ink-2")}>{message ?? "The recording is not available."}</p>
          {stopped.status === "error" && (
            <Button size="sm" onClick={retry}>
              <ArrowClockwise size={16} aria-hidden="true" />
              Try again
            </Button>
          )}
          {stopped.reason === "signed_out" && (
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
          {stopped.reason === "unplayable" && <DownloadRecordingButton />}
        </div>
      ) : (
        <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 md:grid-cols-[44px_minmax(0,1fr)_auto] md:gap-x-4">
          <button
            type="button"
            onClick={toggle}
            disabled={!canPlay}
            aria-label={playing ? "Pause the recording" : "Play the recording"}
            className="inline-flex size-11 items-center justify-center rounded-full bg-ink text-sheet transition-colors duration-150 hover:bg-ink/90 disabled:bg-ink/40"
          >
            {playing ? <Pause size={18} weight="fill" aria-hidden="true" /> : <Play size={18} weight="fill" aria-hidden="true" className="translate-x-px" />}
          </button>
          <div className="col-span-2 row-start-2 md:col-span-1 md:col-start-2 md:row-start-1">
            <Scrubber lengthSec={length} spans={spans} speakerTones={speakerTones} ticks={ticks} />
          </div>
          <div className="flex min-w-0 items-center justify-between gap-1 md:justify-end">
            <p className="font-mono text-[13px] text-ink-2 tnum" aria-live="off">
              <span ref={timeRef}>0:00</span>
              <span className="text-ink-3"> / {formatTimestamp(length)}</span>
              {state.blocked && <span className="ml-2 font-sans text-[12px] text-sienna">Tap to resume</span>}
            </p>
            <div className="flex items-center">
              <Menu>
                <MenuTrigger asChild>
                  <button type="button" aria-label={`Playback speed ${rate}×. Change`} className="inline-flex h-9 min-w-11 items-center justify-center rounded-chip px-2 font-mono text-[13px] font-medium text-ink-2 transition-colors duration-150 tnum hover:bg-raised hover:text-ink lg:h-8">
                    {rate}×
                  </button>
                </MenuTrigger>
                <MenuContent className="min-w-[120px]">
                  {PLAYBACK_RATES.map((r) => (
                    <MenuItem key={r} onSelect={() => setRate(r)} aria-current={r === rate ? "true" : undefined} className={clsx("font-mono tnum", r === rate && "bg-inset")}>
                      {r}×
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
              <DownloadRecordingButton className="px-2" compact />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
