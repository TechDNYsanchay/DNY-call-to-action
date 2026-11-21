import clsx from "clsx";
import { Phone, PhoneIncoming, PhoneOutgoing } from "@phosphor-icons/react/dist/ssr";
import { formatTimestamp } from "@/lib/format";
import type { CallStage } from "@/lib/ui/call-status";
import { Chip, StatusDot } from "@/components/ui/chip";
import { MinuteHeadline } from "@/components/meeting/minute-headline";

// The top of a call page: the minute (or, until the sheet lands, the title "Call with Rakesh (Cafe 89)", or
// "Incoming call on Ashwini's phone"), then one meta line: who, the type chip or the stage, when, how long,
// which way, the line and its people, and "Call back" for the people allowed to see the number.

export interface CallHeaderProps {
  headline: string;
  provisional: boolean;
  who: { text: string; masked: boolean };
  chip: { label: string; tone: "bottle" | "neutral" } | null;
  /** Shown instead of the chip until the call is a client or vendor call. */
  stage: CallStage;
  when: string;
  durationSec: number;
  direction: string;
  line: string;
  /** The full number, for a tel: link; null for everyone else. */
  callBack: string | null;
  className?: string;
}

export function CallHeader({ headline, provisional, who, chip, stage, when, durationSec, direction, line, callBack, className }: CallHeaderProps) {
  const incoming = direction === "incoming";
  const DirectionIcon = incoming ? PhoneIncoming : PhoneOutgoing;
  return (
    <header className={className}>
      <MinuteHeadline provisional={provisional}>{headline}</MinuteHeadline>
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] leading-[18px] text-ink-2">
        <span className={clsx("font-medium text-ink", who.masked && "font-mono tnum")}>{who.text}</span>
        {chip ? (
          <Chip tone={chip.tone}>{chip.label}</Chip>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone={stage.tone} />
            <span className={stage.tone === "signal" ? "text-signal" : stage.tone === "sienna" ? "text-sienna" : "text-ink-2"}>{stage.word}</span>
          </span>
        )}
        <span className="tnum">{when}</span>
        <span aria-hidden="true" className="text-ink-3">
          ·
        </span>
        <span className="font-mono tnum" aria-label={`${Math.round(durationSec / 60)} minutes long`}>
          {formatTimestamp(durationSec)}
        </span>
        <span aria-hidden="true" className="text-ink-3">
          ·
        </span>
        <span className="inline-flex items-center gap-1">
          <DirectionIcon size={14} aria-hidden="true" className="text-ink-3" />
          {incoming ? "Incoming" : "Outgoing"}
        </span>
        <span aria-hidden="true" className="text-ink-3">
          ·
        </span>
        <span>{line}</span>
        {callBack && (
          <a href={`tel:${callBack}`} className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-chip border border-strong bg-sheet px-2.5 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-raised">
            <Phone size={14} aria-hidden="true" />
            Call back
          </a>
        )}
      </p>
    </header>
  );
}
