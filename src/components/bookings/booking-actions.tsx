"use client";

import { Copy, VideoCamera } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelClientMeeting } from "@/app/(app)/bookings/actions";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

// The buttons on a meeting still to come: join, copy the Meet link, and cancel (with a confirm,
// because cancelling emails every guest).

export function BookingActions({ id, meetUrl, clientName, when, canCancel }: { id: string; meetUrl: string | null; clientName: string; when: string; canCancel: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const copy = async () => {
    if (!meetUrl) return;
    try {
      await navigator.clipboard.writeText(meetUrl);
      toast({ message: "Meet link copied" });
    } catch {
      toast({ message: "Couldn't copy the link" });
    }
  };

  const cancel = () =>
    start(async () => {
      setError(null);
      const result = await cancelClientMeeting(id);
      if (!result.ok) return setError(result.error);
      setOpen(false);
      toast({ message: `Meeting with ${clientName} cancelled; guests are told by email` });
      router.refresh();
    });

  return (
    <div className="flex items-center gap-1">
      {meetUrl && (
        <>
          <a href={meetUrl} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
            <VideoCamera size={15} aria-hidden="true" />
            Join
          </a>
          <Button variant="ghost" size="sm" onClick={copy} aria-label={`Copy the Meet link for ${clientName}`}>
            <Copy size={15} aria-hidden="true" />
            <span className="hidden sm:inline">Copy link</span>
          </Button>
        </>
      )}
      {canCancel && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="danger" size="sm">
              Cancel
            </Button>
          </DialogTrigger>
          <DialogContent title={`Cancel the meeting with ${clientName}?`} description={`${when} IST. Everyone invited gets a cancellation email from the calendar.`}>
            {error && (
              <p role="alert" className="mb-3 text-[13px] text-signal">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost">Keep it</Button>
              </DialogClose>
              <Button variant="primary" onClick={cancel} disabled={pending}>
                {pending ? "Cancelling…" : "Cancel meeting"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
