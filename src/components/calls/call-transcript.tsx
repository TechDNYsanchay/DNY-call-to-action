import clsx from "clsx";
import { formatTimestamp } from "@/lib/format";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import { spokenTime } from "@/lib/ui/evidence";
import { hasDevanagari } from "@/lib/ui/text";
import { SectionLabel } from "@/components/ui/chip";
import { TranscriptFollower } from "./transcript-follower";

// The call's transcript on the same page as its sheet, rendered on the server from the stored turns. Only the
// time is a button (it plays from there); the words stay plain, selectable text. Before the sheet the
// speakers are the machine's "Speaker 1" and "Speaker 2"; after it, the names the routine mapped, with a
// bottle dot for DNY and a sienna one for the other side.

export interface TranscriptSpeakers {
  /** "Speaker 1" -> "Ashwini (DNY)"; empty before the sheet. */
  names: Record<string, string>;
  sides: Record<string, "dny" | "other">;
}

export function CallTranscript({ turns, speakers, seekable, deepLinkSec, className }: { turns: SpeakerTurn[]; speakers: TranscriptSpeakers; seekable: boolean; deepLinkSec?: number | null; className?: string }) {
  const voices = new Set(turns.map((t) => t.speaker)).size;
  const ids = new Set<string>();
  return (
    <section id="transcript" aria-labelledby="transcript-title" className={clsx("card p-5 sm:p-6", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel id="transcript-title" count={turns.length}>
          Transcript
        </SectionLabel>
        <span className="text-[12px] text-ink-3">
          {voices === 1 ? "Only one voice was recorded." : `${voices} voices`}
          {seekable && <span className="hidden sm:inline"> · tap a time to play from there</span>}
        </span>
      </div>
      <TranscriptFollower turns={turns} deepLinkSec={deepLinkSec}>
        <ol className="mt-2 divide-y divide-hairline">
          {turns.map((t, i) => {
            // Two turns can start in the same second; only the first carries the anchor.
            const anchor = `t-${Math.floor(t.startSec)}`;
            const id = ids.has(anchor) ? undefined : anchor;
            ids.add(anchor);
            const side = speakers.sides[t.speaker];
            const name = speakers.names[t.speaker] ?? t.speaker;
            return (
              <li key={i} id={id} data-start={t.startSec} className="-mx-2 flex gap-3 rounded-[6px] px-2 py-2.5 transition-colors duration-300 data-active:bg-bottle-tint/60 sm:gap-4">
                {seekable ? (
                  <button
                    type="button"
                    data-seek={t.startSec}
                    tabIndex={i === 0 ? 0 : -1}
                    aria-label={`Play from ${spokenTime(t.startSec)}, ${name}`}
                    className="-my-1 h-7 w-[52px] shrink-0 rounded-[4px] text-left font-mono text-[12px] text-ink-3 transition-colors duration-150 tnum hover:bg-raised hover:text-ink"
                  >
                    {formatTimestamp(t.startSec)}
                  </button>
                ) : (
                  <span className="w-[52px] shrink-0 pt-0.5 font-mono text-[12px] text-ink-3 tnum">{formatTimestamp(t.startSec)}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[12px] leading-4 font-medium text-ink-2">
                    <span aria-hidden="true" className={clsx("size-1.5 shrink-0 rounded-full", side === "dny" ? "bg-bottle" : side === "other" ? "bg-sienna" : "bg-ink-3")} />
                    {name}
                  </p>
                  <p className={hasDevanagari(t.text) ? "devanagari mt-0.5 text-[15px] leading-[22px] text-ink" : "mt-0.5 text-[15px] leading-[22px] text-ink lg:text-[14px] lg:leading-[20px]"}>{t.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </TranscriptFollower>
    </section>
  );
}
