"use client";

import clsx from "clsx";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { formatTimestamp } from "@/lib/format";
import { evidenceAriaLabel } from "@/lib/ui/evidence";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { EvidenceQuote } from "./evidence-quote";

// The mono "12:34" pill. Click (or tap) shows the speaker and the quote; the popover links to the
// recording, at that second when the URL parameter is known. Approximate matches get a dashed edge.

export interface EvidenceProps {
  seconds: number | null;
  speaker: string | null;
  quote: string | null;
  quoteEnglish?: string | null;
  recordingHref: string | null;
  verified?: boolean;
  /** Number of further quotes behind this entry ("12:34 +1"). */
  more?: number;
}

export function EvidencePill({ seconds, speaker, quote, quoteEnglish, recordingHref, verified = true, more = 0 }: EvidenceProps) {
  if (seconds == null && !quote) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={evidenceAriaLabel(seconds, speaker)}
          className={clsx(
            "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 font-mono text-[12px] leading-none text-ink-2 transition-colors duration-150 hover:border-strong hover:text-ink tnum",
            verified ? "border-hairline bg-sheet" : "border-dashed border-strong bg-inset",
          )}
        >
          {seconds != null ? formatTimestamp(seconds) : "quote"}
          {more > 0 && <span className="text-ink-3">+{more}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <EvidenceQuote seconds={seconds} speaker={speaker} quote={quote} quoteEnglish={quoteEnglish} verified={verified} className="border-transparent bg-transparent px-0 py-0" />
        {recordingHref && (
          <a href={recordingHref} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-chip px-2 text-[13px] font-medium text-ink hover:bg-raised">
            <ArrowSquareOut size={14} aria-hidden="true" />
            Open recording{seconds != null ? ` at ${formatTimestamp(seconds)}` : ""}
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}
