import clsx from "clsx";
import { PhoneIncoming, PhoneOutgoing } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { CallRow, LineSummary } from "@/lib/data/calls";
import { formatTimestamp, timeAgo } from "@/lib/format";
import { callStage, callTypeChip, callWho, type StageOptions } from "@/lib/ui/call-status";
import { Chip, CountTriple, StatusDot } from "@/components/ui/chip";

// One line in the Calls list: the stage dot and which way the call went, who it was with (the client, the
// contact saved on the phone once it is a business call, or the masked number), the minute once the sheet
// exists or else the stage in words with the length and the line, then the counts and the time. At least
// 56 px tall on phones. A call that was not a work call is shown faded, only when asked for.

const TONE_TEXT = { signal: "text-signal", sienna: "text-sienna", bottle: "text-bottle" } as const;

export function CallListRow({ row, lines, stageOptions, now }: { row: CallRow; lines: Map<string, LineSummary>; stageOptions: StageOptions; now: Date }) {
  const stage = callStage(row, row.call, stageOptions);
  const done = row.process_status === "done";
  const who = callWho(row, row.call);
  const chip = callTypeChip(row.type, true);
  const line = lines.get(row.call.line_id)?.name ?? "a removed line";
  const incoming = row.call.direction === "incoming";
  const DirectionIcon = incoming ? PhoneIncoming : PhoneOutgoing;
  const toneText = TONE_TEXT[stage.tone as keyof typeof TONE_TEXT] ?? "text-ink-3";
  const otherSide = { word: row.type === "vendor" ? ("vendor" as const) : ("client" as const) };

  return (
    <li>
      <Link
        href={`/calls/${row.id}`}
        className={clsx("group flex min-h-14 items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-raised focus-visible:bg-raised lg:min-h-12", row.process_status === "skipped" && "opacity-70")}
      >
        <StatusDot tone={stage.tone} />
        <DirectionIcon size={16} role="img" aria-label={incoming ? "Incoming call" : "Outgoing call"} className="shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={clsx("truncate text-[15px] font-medium text-ink lg:text-[14px]", who.masked && "font-mono tnum")}>{who.text}</span>
            {chip && (
              <Chip tone={chip.tone} className="h-5 shrink-0 px-1.5 text-[11px]">
                {chip.label}
              </Chip>
            )}
            <span className="ml-auto shrink-0 text-[12px] text-ink-3 tnum lg:hidden">{timeAgo(row.happened_at, now)}</span>
          </div>
          <p className={clsx("truncate text-[14px] leading-[20px] lg:text-[13px] lg:leading-[18px]", done ? "text-ink-2" : "text-ink-3")}>
            {done && row.headline ? (
              row.headline
            ) : (
              <>
                <span className={toneText}>{stage.word}</span>
                {/* On desktop the length has its own column. */}
                <span className="lg:hidden">
                  {" "}
                  · <span className="font-mono tnum">{formatTimestamp(row.duration_sec)}</span>
                </span>
                <span> · {line}</span>
              </>
            )}
          </p>
        </div>
        {/* Phones show the who, the stage and the time only; the counts join from the small tablet width. */}
        <span className={clsx("hidden shrink-0 sm:block", !done && "invisible")}>
          <CountTriple dny={row.counts.dny} client={row.counts.client} decisions={row.counts.decisions} otherSide={otherSide} />
        </span>
        <span className="hidden w-[44px] shrink-0 text-right font-mono text-[12px] text-ink-3 tnum lg:inline">{formatTimestamp(row.duration_sec)}</span>
        <span className="hidden w-[76px] shrink-0 text-right text-[12px] text-ink-3 tnum lg:inline">{timeAgo(row.happened_at, now)}</span>
      </Link>
    </li>
  );
}
