"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { findCallsByNumber } from "@/app/(app)/calls/actions";
import type { CallRow, LineSummary } from "@/lib/data/calls";
import type { ClientRef } from "@/lib/data/types";
import type { StageOptions } from "@/lib/ui/call-status";
import { CALLS_PAGE_SIZE, type CallsQuery, callsHref, callsSearchOf } from "@/lib/ui/calls-query";
import { groupMeetings } from "@/lib/ui/group-meetings";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { EmptyState, InlineNote } from "@/components/ui/states";
import { CallGroups } from "./call-groups";
import { CallsFilterBar, type LineOption } from "./calls-filter-bar";

// The Calls list's filters and search box, above the list. Filters and text searches live in the URL. A number
// never does: Vercel's request log and the browser's history keep addresses, and a client's number is personal
// data. A search of seven or more digits stays in this component, findCallsByNumber answers it from the request
// body, and its calls replace the page's list until the box is cleared. Back from a call, the search returns from
// the history entry's state (never shown, never sent); a fresh visit to Calls starts clean.

const SEARCH_DELAY_MS = 300;
const HISTORY_KEY = "ctaCallsNumber";

const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

function savedNumber(): string | null {
  try {
    const value = (window.history.state as Record<string, unknown> | null)?.[HISTORY_KEY];
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

/** Keeps the number search in this history entry's state. Next.js's own navigations replace that state, so it is written again after each. */
function saveNumber(text: string | null) {
  if (savedNumber() === text) return;
  try {
    const state: Record<string, unknown> = { ...((window.history.state as Record<string, unknown> | null) ?? {}) };
    if (text) state[HISTORY_KEY] = text;
    else delete state[HISTORY_KEY];
    window.history.replaceState(state, "");
  } catch {
    // A browser that limits history writes: the search is only not restored on the way back.
  }
}

type NumberResult = { digits: string } & ({ rows: CallRow[]; hasMore: boolean } | { error: string });

export function CallsBrowser({
  query,
  initialNumber,
  lines,
  clients,
  rowLines,
  stage,
  nowIso,
  children,
}: {
  /** The URL's state; its `q` is never a number. */
  query: CallsQuery;
  /** A number someone typed into the address itself: searched here, and dropped from the URL. */
  initialNumber: string | null;
  lines: LineOption[];
  clients: ClientRef[];
  /** Every line, for the rows' line names. */
  rowLines: LineSummary[];
  stage: Omit<StageOptions, "now">;
  nowIso: string;
  /** The page's own list (or its empty state) and paging, shown whenever no number is searched. */
  children: ReactNode;
}) {
  const router = useRouter();
  // Hydration renders what the server did (no number); a mount in the browser (back from a call) may restore one.
  const client = useSyncExternalStore(noSubscribe, onClient, onServer);
  const [start] = useState(() => initialNumber ?? (client ? savedNumber() : null));
  /** The text of the number being searched, or null. */
  const [numberText, setNumberText] = useState<string | null>(start);
  const [text, setText] = useState(start ?? query.q);
  // The URL's text search changed under us (back button, "Clear filters"): the box follows it. An empty one
  // leaves a number search alone, since starting one is what empties it.
  const [seenQ, setSeenQ] = useState(query.q);
  if (query.q !== seenQ) {
    setSeenQ(query.q);
    if (query.q || numberText === null) {
      setText(query.q);
      setNumberText(null);
    }
  }

  const latest = useRef(query);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    latest.current = query;
  }, [query]);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const apply = (value: string) => {
    const q = latest.current;
    if (callsSearchOf(value)?.kind === "digits") {
      setNumberText(value.trim());
      if (q.q) router.replace(callsHref({ ...q, q: "", page: 1 }));
      return;
    }
    setNumberText(null);
    const next = value.trim();
    if (next !== q.q) router.replace(callsHref({ ...q, q: next, page: 1 }));
  };
  const onSearch = (value: string, opts: { now?: boolean } = {}) => {
    setText(value);
    if (timer.current) window.clearTimeout(timer.current);
    if (opts.now) apply(value);
    else timer.current = window.setTimeout(() => apply(value), SEARCH_DELAY_MS);
  };

  // A number typed into the address leaves it at once; the search itself carries on here.
  useEffect(() => {
    if (initialNumber) router.replace(callsHref({ ...query, q: "", page: 1 }));
  }, [initialNumber, query, router]);
  // After every render: this entry's state holds the search (or not), so "back" can bring it back.
  useEffect(() => {
    saveNumber(numberText);
  }, [numberText, query]);

  const search = numberText ? callsSearchOf(numberText) : null;
  const digits = search?.kind === "digits" ? search.digits : null;
  const [result, setResult] = useState<NumberResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [searching, startSearch] = useTransition();
  // Again when the filters change, when the page refreshes (Realtime, a poll), and on "Try again".
  useEffect(() => {
    if (!digits) return;
    let current = true;
    startSearch(async () => {
      const reply = await findCallsByNumber(digits, { filter: query.filter, lineId: query.lineId, clientId: query.clientId, showNotWork: query.showNotWork });
      if (!current) return;
      setResult(reply.ok ? { digits, rows: reply.data?.rows ?? [], hasMore: reply.data?.hasMore ?? false } : { digits, error: reply.error });
    });
    return () => {
      current = false;
    };
  }, [digits, query.filter, query.lineId, query.clientId, query.showNotWork, nowIso, attempt]);

  const clear = () => onSearch("", { now: true });
  // Not-work calls are never client or vendor calls, so that switch does not narrow a number search.
  const narrowed = query.filter !== "all" || Boolean(query.lineId || query.clientId);
  const shown = result && result.digits === digits ? result : null;
  const now = new Date(nowIso);

  let body: ReactNode = children;
  if (digits) {
    if (!shown) body = <ListSkeleton rows={3} />;
    else if ("error" in shown)
      body = (
        <InlineNote
          tone="signal"
          title="The search did not finish"
          actions={
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)} disabled={searching}>
              Try again
            </Button>
          }
        >
          {shown.error}
        </InlineNote>
      );
    else if (!shown.rows.length)
      body = (
        <EmptyState
          title="Nothing matches."
          action={
            <Button variant="secondary" onClick={clear}>
              Clear search
            </Button>
          }
        >
          No client or vendor call with that number{narrowed ? " among the calls these filters show" : ""}. Calls not yet confirmed as work calls are not searched by number.
        </EmptyState>
      );
    else
      body = (
        <>
          <CallGroups groups={groupMeetings(shown.rows, now)} lines={new Map(rowLines.map((l) => [l.id, l]))} stageOptions={{ ...stage, now }} now={now} />
          {shown.hasMore && (
            <p className="mt-3 text-center text-[13px] leading-[18px] text-ink-3">
              The {CALLS_PAGE_SIZE} newest calls with this number. Choose a type, a phone or a client above for older ones.
            </p>
          )}
        </>
      );
  }

  return (
    <>
      <CallsFilterBar query={query} lines={lines} clients={clients} search={text} onSearch={onSearch} />
      {digits ? (
        <div aria-busy={searching || undefined} className={clsx("transition-opacity duration-150", searching && shown && "opacity-60")}>
          {body}
        </div>
      ) : (
        body
      )}
    </>
  );
}
