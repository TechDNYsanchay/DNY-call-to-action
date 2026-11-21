"use client";

import clsx from "clsx";
import { ArrowSquareOut, Play } from "@phosphor-icons/react";
import { formatTimestamp } from "@/lib/format";
import { evidenceAriaLabel, spokenTime } from "@/lib/ui/evidence";
import { useRecordingOptional } from "@/components/calls/recording-provider";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { EvidenceQuote } from "./evidence-quote";

// The mono "12:34" pill. Click (or tap) shows the speaker and the quote; the popover links to the
// recording, at that second when the URL parameter is known. Approximate matches get a dashed edge.
// On a call page whose recording can play, the popover holds a large "Play from 12:34" instead, which
// plays from a second before the words; one tap only ever opens the popover.

export interface EvidenceProps {
  seconds: number | null;
  speaker: string | null;
  quote: string | null;
  quoteEnglish?: string | null;
  recordingHref: string | null;
  verified?: boolean;
  /** Number of further quotes behind this entry ("12:34 +1"). */
  more?: number;
  /** The second the quote is said, when the save found it (call sheets). */
  refinedSec?: number | null;
}

export function EvidencePill({ seconds, speaker, quote, quoteEnglish, recordingHref, verified = true, more = 0, refinedSec }: EvidenceProps) {
  const recording = useRecordingOptional();
  if (seconds == null && !quote) return null;
  const playable = Boolean(recording?.canPlay) && seconds != null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={playable ? `Show quote at ${spokenTime(seconds ?? 0)}${speaker ? `, from ${speaker}` : ""}` : evidenceAriaLabel(seconds, speaker)}
          className={clsx(
            "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 font-mono text-[12px] leading-none text-ink-2 transition-colors duration-150 hover:border-strong hover:text-ink tnum",
            verified ? "border-hairline bg-sheet" : "border-dashed border-strong bg-inset",
          )}
        >
          {playable && <Play size={9} weight="fill" aria-hidden="true" className="text-ink-3" />}
          {seconds != null ? formatTimestamp(seconds) : "quote"}
          {more > 0 && <span className="text-ink-3">+{more}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <EvidenceQuote seconds={seconds} speaker={speaker} quote={quote} quoteEnglish={quoteEnglish} verified={verified} className="border-transparent bg-transparent px-0 py-0" />
        {playable && recording && seconds != null ? (
          <PopoverClose asChild>
            <button
              type="button"
              onClick={() => recording.seekToQuote(seconds, quote, refinedSec ?? null, { play: true })}
              className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-chip bg-ink px-4 text-[14px] font-medium text-sheet transition-colors duration-150 hover:bg-ink/90 lg:h-10"
            >
              <Play size={14} weight="fill" aria-hidden="true" />
              Play from <span className="font-mono tnum">{formatTimestamp(seconds)}</span>
            </button>
          </PopoverClose>
        ) : (
          recordingHref && (
            <a href={recordingHref} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-chip px-2 text-[13px] font-medium text-ink hover:bg-raised">
              <ArrowSquareOut size={14} aria-hidden="true" />
              Open recording{seconds != null ? ` at ${formatTimestamp(seconds)}` : ""}
            </a>
          )
        )}
      </PopoverContent>
    </Popover>
  );
}
