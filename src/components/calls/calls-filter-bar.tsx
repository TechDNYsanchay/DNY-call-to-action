"use client";

import clsx from "clsx";
import { MagnifyingGlass, SlidersHorizontal, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClientRef } from "@/lib/data/types";
import { CALLS_FILTERS, type CallsQuery, callsHref, sheetFilterCount } from "@/lib/ui/calls-query";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect } from "@/components/ui/fields";
import { Dialog, DialogTrigger, SideSheetContent } from "@/components/ui/primitives";

// The Calls list's filters, in the URL so a filtered list can be bookmarked: All · Client · Vendor · Needs your
// decision, the phone line, the client, "Show not-work calls". The search box (a contact, a client, a minute, or
// seven or more digits of a number) belongs to CallsBrowser, which keeps a number out of the URL. On phones the
// chips scroll in one row, the search stays in view, and the line, client and not-work switch sit behind a
// Filters button.

export interface LineOption {
  id: string;
  name: string;
}

export function CallsFilterBar({
  query,
  lines,
  clients,
  search,
  onSearch,
}: {
  query: CallsQuery;
  lines: LineOption[];
  clients: ClientRef[];
  /** What the search box shows. */
  search: string;
  /** Typing (applied after a pause), or clearing the box (`now`, applied at once). */
  onSearch: (value: string, opts?: { now?: boolean }) => void;
}) {
  const router = useRouter();
  const extra = sheetFilterCount(query);

  const go = (next: Partial<CallsQuery>) => router.replace(callsHref({ ...query, page: 1, ...next }));

  const lineSelect = (id: string, className?: string) => (
    <NativeSelect id={id} aria-label="Phone line" value={query.lineId ?? ""} onChange={(e) => go({ lineId: e.target.value || null })} className={className}>
      <option value="">Every phone</option>
      {lines.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </NativeSelect>
  );
  const clientSelect = (id: string, className?: string) => (
    <NativeSelect id={id} aria-label="Client" value={query.clientId ?? ""} onChange={(e) => go({ clientId: e.target.value || null })} className={className}>
      <option value="">Every client</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </NativeSelect>
  );
  const notWorkToggle = (
    <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-[13px] text-ink-2 select-none lg:h-8">
      <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={query.showNotWork} onChange={(e) => go({ showNotWork: e.target.checked })} />
      Show not-work calls
    </label>
  );

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div role="group" aria-label="Filter" className="hide-scrollbar -mx-4 flex min-w-0 flex-1 overflow-x-auto px-4 md:mx-0 md:flex-none md:px-0">
          <div className="flex shrink-0 items-center gap-1 rounded-chip bg-inset p-0.5">
            {CALLS_FILTERS.map((f) => {
              const active = query.filter === f.key;
              return (
                <Link
                  key={f.key}
                  href={callsHref({ ...query, page: 1, filter: f.key })}
                  replace
                  aria-current={active ? "true" : undefined}
                  className={clsx("inline-flex h-9 items-center rounded-[5px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 lg:h-8", active ? "bg-sheet text-ink shadow-card" : "text-ink-2 hover:text-ink")}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          {lines.length > 1 && lineSelect("calls-line", "h-9 w-auto min-w-[150px] bg-sheet lg:h-8 lg:text-[13px]")}
          {clientSelect("calls-client", "h-9 w-auto min-w-[150px] bg-sheet lg:h-8 lg:text-[13px]")}
        </div>
        <div className="ml-auto hidden md:block">{notWorkToggle}</div>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlass size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search contact, client, headline or number"
            aria-label="Search calls"
            className="h-11 w-full rounded-chip border border-hairline bg-sheet pr-10 pl-9 text-[15px] text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-strong focus:border-strong lg:h-9 lg:text-[14px]"
          />
          {search && (
            <button type="button" aria-label="Clear search" onClick={() => onSearch("", { now: true })} className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-chip text-ink-3 hover:text-ink">
              <X size={16} />
            </button>
          )}
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="h-11 md:hidden" aria-label={extra ? `Filters, ${extra} on` : "Filters"}>
              <SlidersHorizontal size={16} aria-hidden="true" />
              Filters
              {extra > 0 && <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-ink px-1 font-mono text-[11px] leading-[18px] text-sheet tnum">{extra}</span>}
            </Button>
          </DialogTrigger>
          <SideSheetContent title="Filters">
            <div className="flex flex-col gap-4">
              {lines.length > 1 && (
                <Field label="Phone line" htmlFor="calls-line-sheet">
                  {lineSelect("calls-line-sheet")}
                </Field>
              )}
              <Field label="Client" htmlFor="calls-client-sheet">
                {clientSelect("calls-client-sheet")}
              </Field>
              {notWorkToggle}
              {extra > 0 && (
                <Button variant="ghost" className="self-start" onClick={() => go({ lineId: null, clientId: null, showNotWork: false })}>
                  Clear these filters
                </Button>
              )}
            </div>
          </SideSheetContent>
        </Dialog>
      </div>
    </div>
  );
}
