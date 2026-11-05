import clsx from "clsx";

// Three large mono numerals: for DNY (bottle), for client (sienna), decisions (ink), plus a small
// red risks tag when there are any. Each is a link that scrolls to its section. Numerals never
// count up. Phone: a horizontally scrolling strip of three 112 px chips.

export interface ScoreboardProps {
  dny: number;
  client: number;
  decisions: number;
  risks: number;
  /** Every DNY-owed row done: the first numeral turns green with a check. */
  dnyComplete?: boolean;
  className?: string;
}

export function Scoreboard({ dny, client, decisions, risks, dnyComplete, className }: ScoreboardProps) {
  const cells = [
    { href: "#lane-dny", value: dny, label: "for DNY", tone: dnyComplete ? "text-bottle" : dny ? "text-bottle" : "text-ink-3", done: dnyComplete },
    { href: "#lane-client", value: client, label: "for client", tone: client ? "text-sienna" : "text-ink-3" },
    { href: "#decisions", value: decisions, label: "decisions", tone: decisions ? "text-ink" : "text-ink-3" },
  ];
  return (
    <nav aria-label="Scoreboard" className={clsx("hide-scrollbar -mx-5 flex items-end gap-3 overflow-x-auto px-5 sm:mx-0 sm:px-0 sm:gap-8", className)}>
      {cells.map((c) => (
        <a key={c.href} href={c.href} className="flex w-[112px] shrink-0 flex-col gap-1 rounded-chip py-1 transition-colors duration-150 hover:bg-raised sm:w-auto sm:min-w-[96px] sm:px-2 sm:-mx-2">
          <span className={clsx("flex items-baseline gap-1.5 font-mono text-[32px] leading-none font-medium tnum xl:text-[40px]", c.tone)}>
            {c.value}
            {c.done && (
              <svg width="18" height="18" viewBox="0 0 24 24" aria-label="all done" className="self-center">
                <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className="text-[13px] text-ink-2">{c.label}</span>
        </a>
      ))}
      {risks > 0 && (
        <a href="#risks" className="mb-1.5 ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-chip bg-signal-tint px-2 font-mono text-[12px] font-medium text-signal tnum">
          {risks} {risks === 1 ? "risk" : "risks"}
        </a>
      )}
    </nav>
  );
}
