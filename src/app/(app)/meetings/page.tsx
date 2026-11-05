import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { listClientOptions } from "@/lib/data/clients";
import { listInbox } from "@/lib/data/meetings";
import { groupMeetings } from "@/lib/ui/group-meetings";
import { inboxHref, PAGE_SIZE, parseInboxQuery } from "@/lib/ui/query";
import { FilterBar } from "@/components/inbox/filter-bar";
import { MeetingListRow } from "@/components/inbox/meeting-list-row";
import { RefreshOnFocus } from "@/components/shell/refresh-on-focus";
import { buttonClass } from "@/components/ui/button";
import { ListGroup, PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Meetings" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The inbox: a grouped list, not cards. "Needs your decision" pinned first, then meetings still in
// the pipeline, then finished sheets by the IST day they happened.
export default async function MeetingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const query = parseInboxQuery(await searchParams);
  const [page, clients] = await Promise.all([listInbox(query), listClientOptions()]);
  const now = new Date();
  const groups = groupMeetings([...page.pinned, ...page.rows], now);
  const filtered = query.q || query.clientId || query.filter !== "all" || query.showSkipped;

  return (
    <div className="mx-auto max-w-[880px]">
      <RefreshOnFocus />
      <PageHeader title="Meetings" description={query.page > 1 ? `Page ${query.page}` : "Client meetings from tl;dv, one sheet each"} />
      <FilterBar query={query} clients={clients} />

      {groups.length === 0 ? (
        filtered ? (
          <EmptyState
            title="Nothing matches."
            action={
              <Link href="/meetings" className={buttonClass("secondary")}>
                Clear filters
              </Link>
            }
          >
            Try another word, another client, or show skipped meetings.
          </EmptyState>
        ) : (
          <EmptyState title="No client meetings yet.">Recordings from tl;dv appear here within a few minutes of a meeting ending. Sheets follow after the next hourly analysis run.</EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <ListGroup key={group.key} title={group.title} count={group.rows.length} quiet={group.key === "processing"}>
              {group.rows.map((row) => (
                <MeetingListRow key={row.id} row={row} now={now} />
              ))}
            </ListGroup>
          ))}
        </div>
      )}

      {(page.hasMore || query.page > 1) && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-[13px] text-ink-3">
          {query.page > 1 ? (
            <Link href={inboxHref({ ...query, page: query.page - 1 })} className={buttonClass("ghost", "sm")}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="tnum">
            {PAGE_SIZE} per page · page {query.page}
          </span>
          {page.hasMore ? (
            <Link href={inboxHref({ ...query, page: query.page + 1 })} className={buttonClass("secondary", "sm")}>
              Show more
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
