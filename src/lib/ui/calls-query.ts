// The Calls list URL state (?filter=&line=&client=&q=&page=&notwork=) read and written in one place, and
// what kind of search the box holds. Pure. A search of digits alone looks the number up (business calls
// only, at least 7 digits) and never goes in the URL; anything else matches titles, clients and headlines.

import { normalizeDigitQuery } from "@/lib/phone";

export type CallsFilter = "all" | "client" | "vendor" | "decide";

export interface CallsQuery {
  filter: CallsFilter;
  lineId: string | null;
  clientId: string | null;
  q: string;
  page: number;
  showNotWork: boolean;
}

export const CALLS_PAGE_SIZE = 50;

export const CALLS_FILTERS: Array<{ key: CallsFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "client", label: "Client" },
  { key: "vendor", label: "Vendor" },
  { key: "decide", label: "Needs your decision" },
];

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | undefined): string | null => (v && UUID.test(v) ? v.toLowerCase() : null);

export function parseCallsQuery(params: Params): CallsQuery {
  const filter = first(params.filter);
  const page = Number(first(params.page) ?? "1");
  return {
    filter: filter === "client" || filter === "vendor" || filter === "decide" ? filter : "all",
    lineId: uuidOrNull(first(params.line)),
    clientId: uuidOrNull(first(params.client)),
    q: (first(params.q) ?? "").trim().slice(0, 80),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    showNotWork: first(params.notwork) === "1",
  };
}

/**
 * The query string for a changed state; defaults are left out so the plain URL stays clean. A number is never
 * written: addresses end up in request logs and browser history (CallsBrowser searches numbers without them).
 */
export function callsHref(query: Partial<CallsQuery>, base = "/calls"): string {
  const p = new URLSearchParams();
  if (query.filter && query.filter !== "all") p.set("filter", query.filter);
  if (query.lineId) p.set("line", query.lineId);
  if (query.clientId) p.set("client", query.clientId);
  if (query.q && callsSearchOf(query.q)?.kind !== "digits") p.set("q", query.q);
  if (query.page && query.page > 1) p.set("page", String(query.page));
  if (query.showNotWork) p.set("notwork", "1");
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export const isFilteredCalls = (q: CallsQuery): boolean => Boolean(q.q || q.lineId || q.clientId || q.filter !== "all" || q.showNotWork);

/**
 * One page as read (`size` + 1 rows: the extra one says there is more), less the rows pinned above it. Paging is
 * decided on the rows as read: the newest calls are often pinned (still moving, or waiting for a person), and
 * dropping them first would hide "Show more" and show the extra row on this page and the next.
 */
export function pageAfterPinned<T extends { id: string }>(read: T[], pinnedIds: ReadonlySet<string>, size = CALLS_PAGE_SIZE): { rows: T[]; hasMore: boolean } {
  return { rows: read.slice(0, size).filter((r) => !pinnedIds.has(r.id)), hasMore: read.length > size };
}

/** Filters other than the chips and the search (the phone's "Filters" sheet), for its count badge. */
export const sheetFilterCount = (q: CallsQuery): number => [q.lineId, q.clientId, q.showNotWork].filter(Boolean).length;

export type CallsSearch = { kind: "digits"; digits: string } | { kind: "text"; text: string; shortNumber: boolean } | null;

/**
 * Digits only (spaces, +, brackets and dashes allowed) with at least 7 of them: a number search. Fewer
 * digits stay a text search, flagged so the empty state can ask for more digits.
 */
export function callsSearchOf(q: string): CallsSearch {
  const text = q.trim();
  if (!text) return null;
  const numeric = /^[\d\s+().-]+$/.test(text);
  if (numeric) {
    const digits = normalizeDigitQuery(text);
    if (digits) return { kind: "digits", digits };
    return { kind: "text", text, shortNumber: true };
  }
  return { kind: "text", text, shortNumber: false };
}
