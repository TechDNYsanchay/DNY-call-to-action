import clsx from "clsx";
import Link from "next/link";
import type { ActionItemRow } from "@/lib/data/types";
import { daysUntil, formatShortDate, relativeDue } from "@/lib/format";
import { firstName } from "@/lib/ui/text";
import { Chip, Pill, PriorityDot } from "@/components/ui/chip";
import { QuickDone } from "./quick-done";

// A compact action line for lists that span meetings (My actions, client page): checkbox, title,
// where it came from, owner, due. The full row with evidence and menus lives on the sheet.

export function ItemLine({ item, context, now = new Date() }: { item: ActionItemRow; context?: { href: string; label: string }; now?: Date }) {
  const overdue = item.due_date ? daysUntil(item.due_date, now) < 0 : false;
  const owner = firstName(item.owner_name) ?? item.owner_email?.split("@")[0] ?? null;
  return (
    <li className="flex min-h-14 items-start gap-1 px-2 py-1.5 lg:min-h-12 lg:gap-2 lg:px-3">
      <QuickDone itemId={item.id} done={item.status === "done"} title={item.title} />
      <div className="min-w-0 flex-1 py-2">
        <div className="flex items-start gap-2">
          <PriorityDot priority={item.priority} className="mt-0.5" />
          <p className={clsx("min-w-0 flex-1 text-[15px] leading-[22px] text-ink lg:text-[14px] lg:leading-[20px]", item.status === "done" && "text-ink-3 line-through")}>{item.title}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-6 text-[12px] text-ink-3">
          {context && (
            <Link href={context.href} className="max-w-[60%] truncate text-ink-2 hover:underline">
              {context.label}
            </Link>
          )}
          {owner && (
            <Pill tone={item.owed_by === "client" ? "sienna" : "bottle"} className="h-5">
              {owner}
            </Pill>
          )}
          {item.due_date ? (
            <Chip tone={overdue ? "signal" : "neutral"} mono className="h-5">
              {formatShortDate(item.due_date)}
              <span className="font-sans font-normal opacity-80">· {relativeDue(item.due_date, now)}</span>
            </Chip>
          ) : (
            <span className="dashed-chip inline-flex h-5 items-center rounded-chip px-1.5 text-[11px]">No date</span>
          )}
        </div>
      </div>
    </li>
  );
}
