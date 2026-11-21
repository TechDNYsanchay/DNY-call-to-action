import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { getCallFeedStatus, listCalls, readCallsSettings } from "@/lib/data/calls";
import { listClientOptions } from "@/lib/data/clients";
import { blocksFeed, feedProblems, isCallInProgress, type StageOptions } from "@/lib/ui/call-status";
import { CALLS_PAGE_SIZE, callsHref, callsSearchOf, isFilteredCalls, parseCallsQuery } from "@/lib/ui/calls-query";
import { groupMeetings } from "@/lib/ui/group-meetings";
import { CallGroups } from "@/components/calls/call-groups";
import { CallsBrowser } from "@/components/calls/calls-browser";
import { CallsLive } from "@/components/calls/calls-live";
import { FeedStatus } from "@/components/calls/feed-status";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Calls" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Phone calls on DNY's client lines, grouped like the meetings inbox: calls that need a person first, then
// calls still moving through the pipeline, then finished sheets by the IST day they happened. Above them, a
// line that says where today's calls went, and what is wrong with the feed when something is. A search by
// number never comes through the URL (CallsBrowser runs it); one typed into the address is handed over and
// dropped from it.
export default async function CallsPage({ searchParams }: { searchParams: SearchParams }) {
  const { isAdmin } = await requireUser();
  const fromUrl = parseCallsQuery(await searchParams);
  const urlNumber = callsSearchOf(fromUrl.q)?.kind === "digits" ? fromUrl.q : null;
  const query = urlNumber ? { ...fromUrl, q: "" } : fromUrl;
  const [page, clients, feed, settings] = await Promise.all([listCalls(query), listClientOptions(), getCallFeedStatus(), readCallsSettings()]);
  const nowIso = new Date().toISOString();
  const now = new Date(nowIso);
  const rows = [...page.pinned, ...page.rows];
  const groups = groupMeetings(rows, now);
  const filtered = isFilteredCalls(query);
  const problems = feedProblems(feed, { isAdmin, capMinutes: settings.maxAudioMinutesPerDay, now });
  const blocked = blocksFeed(problems);
  const stage: Omit<StageOptions, "now"> = {
    pipelinePaused: settings.pipelinePaused,
    claimTimeoutMin: settings.claimTimeoutMinutes,
    decisionHours: settings.decisionHours,
    undecidedFailedDays: settings.undecidedFailedDays,
    sttStop: feed?.sttError ?? null,
  };
  const lines = new Map(page.lines.map((l) => [l.id, l]));
  // The filter offers the lines that are on, and keeps a chosen line that has since been switched off.
  const lineOptions = page.lines.filter((l) => l.enabled || l.id === query.lineId).map((l) => ({ id: l.id, name: l.name }));

  return (
    <div className="mx-auto max-w-[880px]">
      <CallsLive polling={rows.some((r) => isCallInProgress(r.process_status))} />
      <PageHeader title="Calls" description={query.page > 1 ? `Page ${query.page}` : "Client and vendor phone calls from Callyzer, one sheet each"} />
      <FeedStatus status={feed} problems={problems} blocked={blocked} nowIso={nowIso} />
      <CallsBrowser query={query} initialNumber={urlNumber} lines={lineOptions} clients={clients} rowLines={page.lines} stage={stage} nowIso={nowIso}>
        {groups.length === 0 ? (
          query.page > 1 ? (
            // Paged past the last call (an old link, or calls deleted meanwhile): there are calls, just not here.
            <EmptyState
              title="No more calls."
              action={
                <Link href={callsHref({ ...query, page: 1 })} className={buttonClass("secondary")}>
                  Back to page 1
                </Link>
              }
            >
              {filtered ? "This page is past the last call that matches." : "This page is past the last call."}
            </EmptyState>
          ) : filtered ? (
            <EmptyState
              title="Nothing matches."
              action={
                <Link href="/calls" className={buttonClass("secondary")}>
                  Clear filters
                </Link>
              }
            >
              {page.search?.kind === "text" && page.search.shortNumber
                ? "Type at least 7 digits to search by number. A number finds client and vendor calls only."
                : "Try another word, another phone or client, or show not-work calls."}
            </EmptyState>
          ) : blocked ? (
            <EmptyState title="No calls yet.">{problems.map((p) => p.text).join(" ")}</EmptyState>
          ) : (
            <EmptyState title="No calls yet.">Calls on client lines appear here a minute or two after the phone uploads the recording to Callyzer; the sheet follows a few minutes later.</EmptyState>
          )
        ) : (
          <CallGroups groups={groups} lines={lines} stageOptions={{ ...stage, now }} now={now} />
        )}

        {(page.hasMore || query.page > 1) && (
          <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-[13px] text-ink-3">
            {query.page > 1 ? (
              <Link href={callsHref({ ...query, page: query.page - 1 })} className={buttonClass("ghost", "sm")}>
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="tnum">
              {CALLS_PAGE_SIZE} per page · page {query.page}
            </span>
            {page.hasMore ? (
              <Link href={callsHref({ ...query, page: query.page + 1 })} className={buttonClass("secondary", "sm")}>
                Show more
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </CallsBrowser>
    </div>
  );
}
