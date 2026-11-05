import clsx from "clsx";
import Link from "next/link";
import type { InboxRow } from "@/lib/data/types";
import { timeAgo } from "@/lib/format";
import { statusTone, statusWord } from "@/lib/ui/status";
import { domainOf } from "@/lib/ui/text";
import { CountTriple, StatusDot } from "@/components/ui/chip";

// One inbox line: status dot, who, the minute (or the title while processing), three mono counts,
// time ago. Desktop: one line. Phone: two lines with the counts on the first.

export function meetingWho(row: Pick<InboxRow, "client" | "client_name_guess" | "organizer_name" | "organizer_email">): string {
  return row.client?.name ?? row.client_name_guess ?? row.organizer_name ?? domainOf(row.organizer_email) ?? "Unknown organiser";
}

export function MeetingListRow({ row, now = new Date() }: { row: InboxRow; now?: Date }) {
  const done = row.process_status === "done";
  const tone = statusTone(row.process_status);
  const who = meetingWho(row);
  const second = done ? row.headline ?? row.title ?? "Sheet ready" : row.process_status === "needs_decision" ? row.type_reason ?? row.title ?? "Needs your decision" : row.process_status === "failed" ? row.failure_reason ?? "Failed" : row.title ?? "Untitled meeting";
  const status = done ? null : statusWord(row.process_status);

  return (
    <li>
      <Link
        href={`/meetings/${row.id}`}
        className={clsx("group flex min-h-14 items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-raised focus-visible:bg-raised lg:min-h-12", row.process_status === "skipped" && "opacity-70")}
      >
        <StatusDot tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[15px] font-medium text-ink lg:text-[14px]">{who}</span>
            {status && <span className={clsx("hidden shrink-0 text-[12px] lg:inline", tone === "signal" ? "text-signal" : tone === "sienna" ? "text-sienna" : "text-ink-3")}>{status}</span>}
            <span className="ml-auto shrink-0 text-[12px] text-ink-3 tnum lg:hidden">{timeAgo(row.happened_at, now)}</span>
          </div>
          <p className={clsx("truncate text-[14px] leading-[20px] lg:text-[13px] lg:leading-[18px]", done ? "text-ink-2" : "text-ink-3")}>
            {status && <span className={clsx("mr-1.5 lg:hidden", tone === "signal" ? "text-signal" : tone === "sienna" ? "text-sienna" : "text-ink-3")}>{status} ·</span>}
            {second}
          </p>
        </div>
        <CountTriple dny={row.counts.dny} client={row.counts.client} decisions={row.counts.decisions} className={clsx(!done && "invisible")} />
        <span className="hidden w-[76px] shrink-0 text-right text-[12px] text-ink-3 tnum lg:inline">{timeAgo(row.happened_at, now)}</span>
      </Link>
    </li>
  );
}
