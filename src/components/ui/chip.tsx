import clsx from "clsx";
import type { HTMLAttributes, ReactNode } from "react";
import type { Priority } from "@/lib/ui/lanes";
import { PRIORITY_WORDS } from "@/lib/ui/lanes";
import type { Tone } from "@/lib/ui/status";
import { initials } from "@/lib/ui/text";

// Small semantic marks. Hue appears only as text, icon, a 3 px bar or a chip tint; never a card.

export type ChipTone = "neutral" | "bottle" | "sienna" | "signal" | "slate" | "steel";

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "bg-inset text-ink-2",
  bottle: "bg-bottle-tint text-bottle",
  sienna: "bg-sienna-tint text-sienna",
  signal: "bg-signal-tint text-signal",
  slate: "bg-slate-tint text-slate",
  steel: "bg-steel-tint text-steel",
};

/** 6 px radius, 13 px text: type, status and count chips. */
export function Chip({ tone = "neutral", mono, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone; mono?: boolean; children: ReactNode }) {
  return (
    <span className={clsx("inline-flex h-6 items-center gap-1 rounded-chip px-2 text-[12px] font-medium leading-none whitespace-nowrap", mono && "font-mono tnum", CHIP_TONES[tone], className)} {...rest}>
      {children}
    </span>
  );
}

/** 999 px radius: owner and timestamp pills. */
export function Pill({ tone = "neutral", className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone; children: ReactNode }) {
  return (
    <span className={clsx("inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium leading-none whitespace-nowrap", CHIP_TONES[tone], className)} {...rest}>
      {children}
    </span>
  );
}

const DOT_TONES: Record<Tone, string> = {
  ink: "bg-ink",
  bottle: "bg-bottle",
  sienna: "bg-sienna",
  signal: "bg-signal",
  slate: "bg-slate",
  muted: "bg-strong",
  pulse: "bg-slate pulse-dot",
};

/** 8 px status dot; the word next to it carries the meaning, the colour only helps. */
export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden="true" className={clsx("inline-block size-2 shrink-0 rounded-full", DOT_TONES[tone], className)} />;
}

/** P1 filled, P2 half, P3 outline: shape carries the priority, ink only, red stays for risk. */
export function PriorityDot({ priority, className }: { priority: Priority; className?: string }) {
  const word = PRIORITY_WORDS[priority];
  return (
    <span role="img" aria-label={`Priority: ${word}`} title={word} className={clsx("inline-flex size-4 shrink-0 items-center justify-center", className)}>
      {priority === "high" && <span className="size-2 rounded-full bg-ink" />}
      {priority === "medium" && <span className="size-2 rounded-full border border-ink-2" style={{ background: "linear-gradient(90deg, var(--ink-2) 50%, transparent 50%)" }} />}
      {priority === "low" && <span className="size-2 rounded-full border border-strong" />}
    </span>
  );
}

export function Avatar({ name, email, side = "dny", size = 24, className }: { name: string | null; email?: string | null; side?: "dny" | "client" | "unknown"; size?: 20 | 24 | 28 | 32; className?: string }) {
  const tone = side === "dny" ? "bg-bottle-tint text-bottle" : side === "client" ? "bg-sienna-tint text-sienna" : "bg-inset text-ink-2";
  return (
    <span
      title={name ?? email ?? undefined}
      className={clsx("inline-flex shrink-0 items-center justify-center rounded-full font-medium ring-2 ring-sheet", tone, className)}
      style={{ width: size, height: size, fontSize: size <= 24 ? 10 : 11 }}
    >
      {initials(name, email)}
    </span>
  );
}

export function AvatarStack({ people, max = 5 }: { people: Array<{ name: string | null; email: string | null; side: "dny" | "client" | "unknown" }>; max?: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="inline-flex items-center -space-x-1.5" aria-label={`${people.length} attendees`}>
      {shown.map((p, i) => (
        <Avatar key={p.email ?? `${p.name ?? "attendee"}-${i}`} name={p.name} email={p.email} side={p.side} />
      ))}
      {rest > 0 && <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-inset px-1 font-mono text-[10px] text-ink-2 ring-2 ring-sheet tnum">+{rest}</span>}
    </span>
  );
}

/** The three mono counts of an inbox row: DNY-owed, client-owed, decisions. */
export function CountTriple({ dny, client, decisions, className }: { dny: number; client: number; decisions: number; className?: string }) {
  return (
    <span className={clsx("inline-flex items-baseline gap-2 font-mono text-[13px] tnum", className)} aria-label={`${dny} for DNY, ${client} for client, ${decisions} decisions`}>
      <span className={dny ? "text-bottle" : "text-ink-3"}>{dny}</span>
      <span className="text-hairline" aria-hidden="true">
        ·
      </span>
      <span className={client ? "text-sienna" : "text-ink-3"}>{client}</span>
      <span className="text-hairline" aria-hidden="true">
        ·
      </span>
      <span className={decisions ? "text-ink" : "text-ink-3"}>{decisions}</span>
    </span>
  );
}

/** "Decisions · 3": 13 px, 600, muted, count in mono. Never larger than body text. */
export function SectionLabel({ children, count, id, className, as: Tag = "h2" }: { children: ReactNode; count?: number; id?: string; className?: string; as?: "h2" | "h3" | "p" }) {
  return (
    <Tag id={id} className={clsx("flex items-baseline gap-1.5 text-[13px] leading-[18px] font-semibold text-ink-2", className)}>
      {children}
      {count !== undefined && (
        <>
          <span className="text-ink-3" aria-hidden="true">
            ·
          </span>
          <span className="font-mono font-medium text-ink-3 tnum">{count}</span>
        </>
      )}
    </Tag>
  );
}
