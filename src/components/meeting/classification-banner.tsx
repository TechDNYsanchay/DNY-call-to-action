"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { decideMeetingType } from "@/app/(app)/review/actions";
import type { ClientRef, MeetingSummary } from "@/lib/data/types";
import { percent, typeLabel } from "@/lib/ui/status";
import { Button } from "@/components/ui/button";
import { InlineNote } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { DecideTypeDialog } from "@/components/review/decide-type-dialog";
import { RerunButton } from "./rerun-button";

// What sits above the sheet when the meeting needs a person: the low-confidence banner with two
// equal buttons, the failure with its reason and Retry, or the quiet "marked as sales" card. On a
// phone the two decision buttons also live in a sticky bar above the tab bar.

export function ClassificationBanner({ meeting, clients, external, isAdmin }: { meeting: MeetingSummary; clients: ClientRef[]; external: string[]; isAdmin: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const sales = () =>
    start(async () => {
      const result = await decideMeetingType(meeting.id, "sales");
      if (!result.ok) return toast({ message: result.error, tone: "signal" });
      toast({ message: "Marked as a sales meeting." });
      router.refresh();
    });

  const dialogProps = { meetingId: meeting.id, currentType: meeting.type, currentClientId: meeting.client_id, clients, external, clientNameGuess: meeting.client_name_guess, initialType: "client" as const };

  if (meeting.process_status === "needs_decision") {
    const buttons = (
      <>
        <DecideTypeDialog {...dialogProps} trigger={<Button variant="primary" size="lg" className="flex-1">Client meeting</Button>} />
        <Button size="lg" className="flex-1" onClick={sales} disabled={pending}>
          Sales meeting
        </Button>
      </>
    );
    return (
      <>
        <InlineNote title={`Is this a client meeting? ${meeting.type_confidence != null ? `We're ${percent(meeting.type_confidence)} sure.` : ""}`} tone="sienna" actions={<div className="hidden w-full gap-2 sm:flex">{buttons}</div>}>
          {meeting.type_reason ?? "The model could not decide from the transcript."}
        </InlineNote>
        <div className="fixed inset-x-0 bottom-14 z-30 flex gap-2 border-t border-hairline bg-canvas/95 p-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] backdrop-blur sm:hidden">{buttons}</div>
      </>
    );
  }

  if (meeting.process_status === "failed") {
    return (
      <InlineNote title="The analysis did not finish" tone="signal" actions={isAdmin ? <RerunButton meetingId={meeting.id} label="Retry" variant="primary" failed /> : undefined}>
        {meeting.failure_reason ?? "The routine gave up on this meeting."}
        {!isAdmin && " An admin can retry it."}
      </InlineNote>
    );
  }

  if (meeting.process_status === "skipped") {
    return (
      <InlineNote title={`Marked as ${typeLabel(meeting.type).toLowerCase()}`} actions={<DecideTypeDialog {...dialogProps} trigger={<Button size="md">Actually a client meeting</Button>} />}>
        {meeting.type_reason ?? "Not a client meeting, so no sheet was written."}
        {meeting.type === "sales" && " The sales agent reads it from here."}
      </InlineNote>
    );
  }

  return null;
}
