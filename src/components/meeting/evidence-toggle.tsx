"use client";

import clsx from "clsx";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";

// Page-level "Show evidence": the quotes are rendered on the server inside `.evidence-inline`
// blocks; this wrapper reveals them all with one data attribute, so the sections stay server
// components and nothing re-fetches.

export function EvidenceScope({ children, className }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-evidence={open ? "open" : "closed"} className={className}>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          aria-pressed={open}
          onClick={() => setOpen((v) => !v)}
          className={clsx("inline-flex h-8 items-center gap-1.5 rounded-chip px-2.5 text-[13px] font-medium transition-colors duration-150", open ? "bg-inset text-ink" : "text-ink-2 hover:bg-raised hover:text-ink")}
        >
          {open ? <EyeSlash size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          {open ? "Hide evidence" : "Show evidence"}
        </button>
      </div>
      {children}
    </div>
  );
}
