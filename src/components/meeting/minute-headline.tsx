import clsx from "clsx";
import type { MeetingSummary } from "@/lib/data/types";
import { formatDateTimeIst, formatDuration } from "@/lib/format";
import type { Attendee } from "@/lib/ui/participants";
import { confidenceWord, typeLabel } from "@/lib/ui/status";
import { AvatarStack, Chip } from "@/components/ui/chip";

// The top of a sheet: the minute (serif, 28/34/40 px) and one muted meta line. While the sheet is
// not written yet, the tl;dv title stands in, in the same place and size, so nothing jumps later.

export function MinuteHeadline({ children, provisional, className }: { children: string; provisional?: boolean; className?: string }) {
  return (
    <h1 className={clsx("font-serif text-[28px] leading-[1.2] font-medium tracking-[-0.01em] text-balance md:text-[34px] xl:text-[40px] xl:leading-[1.15]", provisional ? "text-ink-2" : "text-ink", className)}>
      {children}
    </h1>
  );
}

export function MetaLine({ meeting, attendees, threshold = 0.8, className }: { meeting: MeetingSummary; attendees: Attendee[]; threshold?: number; className?: string }) {
  const who = meeting.client?.name ?? meeting.client_name_guess ?? null;
  const unsure = meeting.type_source !== "human" ? confidenceWord(meeting.type_confidence, threshold) : null;
  return (
    <p className={clsx("flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] leading-[18px] text-ink-2", className)}>
      {who && <span className="font-medium text-ink">{who}</span>}
      <Chip tone={meeting.type === "client" ? "bottle" : meeting.type === "sales" ? "sienna" : "neutral"}>{typeLabel(meeting.type)}</Chip>
      <span className="tnum">
        {formatDateTimeIst(meeting.happened_at)} · {formatDuration(meeting.duration_sec)}
      </span>
      {attendees.length > 0 && <AvatarStack people={attendees} />}
      {unsure && (
        <span className="inline-flex items-center gap-1.5 text-ink-3">
          <span aria-hidden="true" className="inline-block size-2 rounded-full border border-dashed border-strong" />
          {unsure}
        </span>
      )}
    </p>
  );
}
