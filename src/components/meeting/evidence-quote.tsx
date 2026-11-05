import clsx from "clsx";
import { formatTimestamp } from "@/lib/format";
import { hasDevanagari } from "@/lib/ui/text";

// The quote behind an item, rendered the same way inside the popover and inline on the sheet:
// mono timestamp, speaker, the verbatim words (Devanagari in its own face), English rendering muted.

export function EvidenceQuote({ seconds, speaker, quote, quoteEnglish, verified = true, className }: { seconds: number | null; speaker: string | null; quote: string | null; quoteEnglish?: string | null; verified?: boolean; className?: string }) {
  if (!quote) return null;
  return (
    <blockquote className={clsx("rounded-[6px] border-l-2 border-hairline bg-inset px-3 py-2", className)}>
      <p className="flex items-baseline gap-2 text-[12px] text-ink-3">
        {seconds != null && <span className="font-mono tnum">{formatTimestamp(seconds)}</span>}
        {speaker && <span className="font-medium text-ink-2">{speaker}</span>}
        {!verified && <span title="The quote could not be matched exactly to the transcript">approx.</span>}
      </p>
      <p className={clsx("mt-0.5 font-serif text-[15px] leading-[22px] text-ink italic", hasDevanagari(quote) && "devanagari not-italic")}>{quote}</p>
      {quoteEnglish && quoteEnglish !== quote && <p className="mt-0.5 text-[13px] leading-[18px] text-ink-2">{quoteEnglish}</p>}
    </blockquote>
  );
}
