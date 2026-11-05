"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type DecisionType, decideMeetingType } from "@/app/(app)/review/actions";
import type { ReviewMeeting } from "@/lib/data/meetings";
import type { ClientRef } from "@/lib/data/types";
import { formatDateTimeIst, formatDuration } from "@/lib/format";
import { externalIdentities } from "@/lib/ui/participants";
import { percent, typeLabel } from "@/lib/ui/status";
import { domainOf } from "@/lib/ui/text";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import { DecideTypeDialog } from "./decide-type-dialog";

// One meeting waiting for a decision: title, who, the model's reason and confidence, four buttons.
// "Client meeting" opens the dialog (which client?); the other three save at once. The row leaves
// the list as soon as the server confirms.

export function ReviewRow({ meeting, clients, quiet }: { meeting: ReviewMeeting; clients: ClientRef[]; quiet?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();
  const external = externalIdentities(meeting.participants);
  const who = meeting.client?.name ?? meeting.client_name_guess ?? meeting.organizer_name ?? domainOf(meeting.organizer_email) ?? "Unknown organiser";

  const decide = (type: Exclude<DecisionType, "client">) =>
    start(async () => {
      const result = await decideMeetingType(meeting.id, type);
      if (!result.ok) return toast({ message: result.error, tone: "signal" });
      setGone(true);
      toast({ message: `Marked as ${typeLabel(type).toLowerCase()}.` });
      router.refresh();
    });

  if (gone) return null;

  return (
    <li className={clsx("flex flex-col gap-3 px-4 py-4", pending && "opacity-60")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Link href={`/meetings/${meeting.id}`} className="text-[15px] font-medium text-ink hover:underline lg:text-[14px]">
          {meeting.title ?? "Untitled meeting"}
        </Link>
        <span className="text-[13px] text-ink-3">{who}</span>
        <span className="ml-auto text-[12px] text-ink-3 tnum">
          {formatDateTimeIst(meeting.happened_at)} · {formatDuration(meeting.duration_sec)}
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <Chip tone={quiet ? "neutral" : "sienna"} mono>
          {quiet ? "Sales" : `${typeLabel(meeting.type)} ${percent(meeting.type_confidence)}`}
        </Chip>
        <p className="min-w-0 flex-1 text-[14px] leading-[20px] text-ink-2">{meeting.type_reason ?? (quiet ? "Handed to the sales agent." : "The model could not decide.")}</p>
      </div>
      {external.length > 0 && (
        <p className="font-mono text-[12px] text-ink-3">
          Outside DNY: {external.join(", ")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <DecideTypeDialog
          meetingId={meeting.id}
          currentType={meeting.type}
          currentClientId={meeting.client_id}
          clients={clients}
          external={external}
          clientNameGuess={meeting.client_name_guess}
          initialType="client"
          onDecided={() => setGone(true)}
          trigger={
            <Button variant="primary" size="lg" className="flex-1 sm:flex-none">
              {quiet ? "Actually a client meeting" : "Client meeting"}
            </Button>
          }
        />
        {!quiet && (
          <>
            <Button size="lg" className="flex-1 sm:flex-none" onClick={() => decide("sales")} disabled={pending}>
              Sales meeting
            </Button>
            <Button size="lg" variant="ghost" onClick={() => decide("internal")} disabled={pending}>
              Internal
            </Button>
            <Button size="lg" variant="ghost" onClick={() => decide("other")} disabled={pending}>
              Other
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
