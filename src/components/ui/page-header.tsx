import clsx from "clsx";
import type { ReactNode } from "react";

/** List-page heading: 20 px title, one muted line, actions on the right. Never larger than the minute. */
export function PageHeader({ title, description, actions, className }: { title: string; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={clsx("mb-4 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-[20px] leading-7 font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] leading-[18px] text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A grouped list card: heading row, hairline-divided rows. */
export function ListGroup({ title, count, children, className, quiet }: { title: string; count?: number; children: ReactNode; className?: string; quiet?: boolean }) {
  return (
    <section className={clsx("card overflow-hidden", quiet && "bg-raised", className)} aria-label={title}>
      <header className="flex items-baseline gap-1.5 border-b border-hairline px-4 py-2.5">
        <h2 className="label-xs">{title}</h2>
        {count !== undefined && <span className="font-mono text-[12px] text-ink-3 tnum">{count}</span>}
      </header>
      <ul className="divide-y divide-hairline">{children}</ul>
    </section>
  );
}
