"use client";

import clsx from "clsx";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ClientRef } from "@/lib/data/types";
import { type InboxFilter, type InboxQuery, inboxHref } from "@/lib/ui/query";
import { NativeSelect } from "@/components/ui/fields";

// Filter chips, client select, search and the "show skipped" switch. All state lives in the URL
// so a filtered inbox can be bookmarked; the search is debounced into router.replace.

const FILTERS: Array<{ key: InboxFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "clients", label: "Clients only" },
  { key: "attention", label: "Needs attention" },
];

export function FilterBar({ query, clients }: { query: InboxQuery; clients: ClientRef[] }) {
  const router = useRouter();
  const [q, setQ] = useState(query.q);
  // When the URL changes under us (back button, cleared filters) the input follows the URL.
  const [seenQ, setSeenQ] = useState(query.q);
  if (query.q !== seenQ) {
    setSeenQ(query.q);
    setQ(query.q);
  }
  const timer = useRef<number | null>(null);

  const go = (next: Partial<InboxQuery>) => router.replace(inboxHref({ ...query, page: 1, ...next }));
  const onSearch = (value: string) => {
    setQ(value);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => go({ q: value.trim() }), 300);
  };

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter" className="flex items-center gap-1 rounded-chip bg-inset p-0.5">
          {FILTERS.map((f) => {
            const active = query.filter === f.key;
            return (
              <Link
                key={f.key}
                href={inboxHref({ ...query, page: 1, filter: f.key })}
                replace
                aria-current={active ? "true" : undefined}
                className={clsx("inline-flex h-9 items-center rounded-[5px] px-3 text-[13px] font-medium transition-colors duration-150 lg:h-8", active ? "bg-sheet text-ink shadow-card" : "text-ink-2 hover:text-ink")}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
        <NativeSelect aria-label="Client" value={query.clientId ?? ""} onChange={(e) => go({ clientId: e.target.value || null })} className="h-9 w-auto min-w-[160px] bg-sheet lg:h-8 lg:text-[13px]">
          <option value="">Every client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <label className="ml-auto inline-flex h-9 cursor-pointer items-center gap-2 text-[13px] text-ink-2 select-none lg:h-8">
          <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={query.showSkipped} onChange={(e) => go({ showSkipped: e.target.checked })} />
          Show skipped
        </label>
      </div>
      <div className="relative">
        <MagnifyingGlass size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search titles, minutes and clients"
          aria-label="Search meetings"
          className="h-11 w-full rounded-chip border border-hairline bg-sheet pr-10 pl-9 text-[15px] text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-strong focus:border-strong lg:h-9 lg:text-[14px]"
        />
        {q && (
          <button type="button" aria-label="Clear search" onClick={() => onSearch("")} className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-chip text-ink-3 hover:text-ink">
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
