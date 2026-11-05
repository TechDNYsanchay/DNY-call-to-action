"use client";

import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { rerunMeeting } from "@/app/(app)/meetings/[id]/actions";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

// Admin: queue the meeting for another run (also the "Retry" after a failure). Confirms first,
// because the next sheet becomes a new version; edited rows are kept.

export function RerunButton({ meetingId, label = "Re-run", variant = "secondary", size = "md", failed }: { meetingId: string; label?: string; variant?: ButtonVariant; size?: ButtonSize; failed?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const result = await rerunMeeting(meetingId);
      if (!result.ok) return toast({ message: result.error, tone: "signal" });
      setOpen(false);
      toast({ message: "Queued. The next routine run picks it up (about hourly)." });
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          <ArrowCounterClockwise size={16} aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={failed ? "Try this meeting again?" : "Run the analysis again?"}>
        <p className="text-[14px] leading-[20px] text-ink-2">
          {failed ? "The meeting goes back in the queue with its attempt count as it is. " : "A new sheet version is written; the current one is kept. "}
          Rows you edited, marked done or dismissed keep their state. The routine runs about hourly, so expect the result within the hour.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={run} disabled={pending}>
            {pending ? "Queuing…" : failed ? "Retry" : "Re-run"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
