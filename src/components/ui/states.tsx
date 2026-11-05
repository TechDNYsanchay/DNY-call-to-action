import clsx from "clsx";
import type { ReactNode } from "react";

// Empty and error states in plain words: one serif line, one explanation, at most one action.
// Absence is shown, never hidden ("Nothing owed by the client" is a real line on the sheet).

export function EmptyState({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx("card px-5 py-10 text-center sm:py-14", className)}>
      <p className="font-serif text-[20px] leading-[1.3] text-ink text-balance italic sm:text-[22px]">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-[44ch] text-[14px] leading-[20px] text-ink-2">{children}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** The real reason, plainly, with an idempotent retry when one exists. */
export function ErrorState({ title = "Something went wrong", reason, action, className }: { title?: string; reason?: string | null; action?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={clsx("card border-l-[3px] border-l-signal px-5 py-5", className)}>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {reason && <p className="mt-1 text-[14px] leading-[20px] text-ink-2 break-words">{reason}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A quiet inline line for lanes and sections with nothing in them. */
export function QuietLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={clsx("py-3 text-[14px] leading-[20px] text-ink-3", className)}>{children}</p>;
}

/** Inset note (classification banner, hints): no colour fill, only the inset tone and a heading. */
export function InlineNote({ title, children, tone = "neutral", className, actions }: { title?: string; children?: ReactNode; tone?: "neutral" | "signal" | "bottle" | "sienna"; className?: string; actions?: ReactNode }) {
  const bar = tone === "signal" ? "border-l-signal" : tone === "bottle" ? "border-l-bottle" : tone === "sienna" ? "border-l-sienna" : "border-l-strong";
  return (
    <section role="region" aria-label={title} className={clsx("rounded-card border-l-[3px] bg-inset px-4 py-3", bar, className)}>
      {title && <p className="text-[14px] font-semibold text-ink">{title}</p>}
      {children && <div className="mt-1 text-[14px] leading-[20px] text-ink-2">{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}
