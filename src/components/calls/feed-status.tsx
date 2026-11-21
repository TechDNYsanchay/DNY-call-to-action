import clsx from "clsx";
import { Info } from "@phosphor-icons/react/dist/ssr";
import { type CallFeedStatus, feedSummary } from "@/lib/calls/feed";
import type { FeedProblem } from "@/lib/ui/call-status";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { RelativeTime } from "@/components/ui/relative-time";
import { InlineNote } from "@/components/ui/states";

// The line above the Calls list that says where today's calls went: "Today on client lines: 9 calls ·
// 3 with a sheet · 2 in progress · 4 not analysed", which always adds up, with a Details popover that names
// every bucket in words, and when Callyzer was last read. Problems come first, in words for this person
// (admins get the cause and the fix). A switch that stops the feed is said alone, without the counts.

function Count({ value, tone }: { value: number; tone?: "sienna" }) {
  return <span className={clsx("font-mono font-medium tnum", tone === "sienna" ? "text-sienna" : "text-ink")}>{value}</span>;
}

export function FeedStatus({ status, problems, blocked, nowIso, className }: { status: CallFeedStatus | null; problems: FeedProblem[]; blocked: boolean; nowIso: string; className?: string }) {
  if (!status) return null;
  const s = feedSummary(status);
  return (
    <div className={clsx("mb-4 flex flex-col gap-2", className)}>
      {problems.map((p) => (
        <InlineNote key={p.key} tone={p.tone === "signal" ? "signal" : "neutral"}>
          {p.text}
        </InlineNote>
      ))}
      {!blocked && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-[18px] text-ink-2">
          <span>
            Today on client lines: <Count value={s.total} /> {s.total === 1 ? "call" : "calls"}
          </span>
          <span aria-hidden="true" className="text-ink-3">
            ·
          </span>
          <span>
            <Count value={s.sheets} /> with a sheet
          </span>
          <span aria-hidden="true" className="text-ink-3">
            ·
          </span>
          <span>
            <Count value={s.inProgress} /> in progress
          </span>
          <span aria-hidden="true" className="text-ink-3">
            ·
          </span>
          <span>
            <Count value={s.notAnalysed} /> not analysed
          </span>
          {s.needPerson > 0 && (
            <>
              <span aria-hidden="true" className="text-ink-3">
                ·
              </span>
              <span>
                <Count value={s.needPerson} tone="sienna" /> {s.needPerson === 1 ? "needs" : "need"} a person
              </span>
            </>
          )}
          {s.details.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="inline-flex h-7 items-center gap-1 rounded-chip px-1.5 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink">
                  <Info size={14} aria-hidden="true" />
                  Details
                </button>
              </PopoverTrigger>
              <PopoverContent>
                <p className="label-xs mb-1.5">Today&apos;s calls on client lines</p>
                <ul className="flex flex-col gap-1 text-[13px] leading-[18px] text-ink-2">
                  {s.details.map((d) => (
                    <li key={d.key}>{d.text}</li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
          <span className="text-ink-3 sm:ml-auto">
            Callyzer checked <RelativeTime iso={status.lastPollOkAt} nowIso={nowIso} fallback="not yet today" />
          </span>
        </p>
      )}
    </div>
  );
}
