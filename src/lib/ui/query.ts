// The inbox URL state (?filter=&client=&q=&page=&skipped=) read and written in one place, plus the
// quoting PostgREST needs for values inside .or() filters. Pure.

export type InboxFilter = "all" | "clients" | "attention";

export interface InboxQuery {
  filter: InboxFilter;
  clientId: string | null;
  q: string;
  page: number;
  showSkipped: boolean;
}

export const PAGE_SIZE = 50;

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseInboxQuery(params: Params): InboxQuery {
  const filter = first(params.filter);
  const client = first(params.client);
  const page = Number(first(params.page) ?? "1");
  return {
    filter: filter === "clients" || filter === "attention" ? filter : "all",
    clientId: client && UUID.test(client) ? client : null,
    q: (first(params.q) ?? "").trim().slice(0, 80),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    showSkipped: first(params.skipped) === "1",
  };
}

/** The query string for a changed state; defaults are left out so the plain URL stays clean. */
export function inboxHref(query: Partial<InboxQuery>, base = "/meetings"): string {
  const p = new URLSearchParams();
  if (query.filter && query.filter !== "all") p.set("filter", query.filter);
  if (query.clientId) p.set("client", query.clientId);
  if (query.q) p.set("q", query.q);
  if (query.page && query.page > 1) p.set("page", String(query.page));
  if (query.showSkipped) p.set("skipped", "1");
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/** Double-quote a value for PostgREST filter syntax, so commas, dots and parentheses are literal. */
export function pgQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Escape % and _ for ILIKE so a search for "100%" is literal. */
export function ilikePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
