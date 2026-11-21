import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { listMyItems, type MyItem } from "@/lib/data/action-items";
import { groupByDue } from "@/lib/ui/lanes";
import { ItemLine } from "@/components/meeting/item-line";
import { RefreshOnFocus } from "@/components/shell/refresh-on-focus";
import { ListGroup, PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "My actions" };

/** Where an item came from: its meeting, or its call at the second the quote is said. */
function itemContext(item: MyItem): { href: string; label: string } | undefined {
  const m = item.meeting;
  if (!m) return undefined;
  if (m.kind === "call") return { href: `/calls/${m.id}${item.evidence_ts_sec != null ? `?t=${item.evidence_ts_sec}` : ""}`, label: m.client?.name ?? m.title ?? "Call" };
  return { href: `/meetings/${m.id}`, label: m.client?.name ?? m.title ?? "Meeting" };
}

// Every open action owned by the signed-in person across meetings and calls, grouped by when it is due.
export default async function MinePage() {
  const { person } = await requireUser();
  const items = await listMyItems(person);
  const now = new Date();
  const groups = groupByDue(items, now);

  return (
    <div className="mx-auto max-w-[880px]">
      <RefreshOnFocus />
      <PageHeader title="My actions" description={`Owed by ${person.full_name}, across every client`} />
      {groups.length === 0 ? (
        <EmptyState title="You're clear.">Actions assigned to you in client meetings will appear here, grouped by when they are due.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <ListGroup key={g.key} title={g.title} count={g.rows.length}>
              {g.rows.map((item) => (
                <ItemLine key={item.id} item={item} now={now} context={itemContext(item)} />
              ))}
            </ListGroup>
          ))}
        </div>
      )}
    </div>
  );
}
