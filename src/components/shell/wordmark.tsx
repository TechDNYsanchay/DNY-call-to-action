import clsx from "clsx";
import Link from "next/link";

/** "Call to Action" with the three-bar mark: DNY owes, client owes, decisions. */
export function Wordmark({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <Link href="/meetings" className={clsx("inline-flex items-center gap-2.5 rounded-chip text-ink", className)} aria-label="Call to Action, home">
      <Mark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Call to Action</span>
          <span className="mt-0.5 text-[11px] text-ink-3">DNY Hospitality</span>
        </span>
      )}
    </Link>
  );
}

export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <rect x="3" y="4" width="18" height="3" rx="1.5" fill="var(--bottle)" />
      <rect x="3" y="10.5" width="13" height="3" rx="1.5" fill="var(--sienna)" />
      <rect x="3" y="17" width="8" height="3" rx="1.5" fill="var(--ink)" />
    </svg>
  );
}
