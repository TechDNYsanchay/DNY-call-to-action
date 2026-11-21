"use client";

import { ArrowClockwise, ArrowsClockwise, Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideCall, linkCallClient, markCallNotWork, rerunCall, retryCallAnalysis, retryCallTranscription, setCallType } from "@/app/(app)/calls/[id]/actions";
import type { ClientRef } from "@/lib/data/types";
import type { ActionResult } from "@/lib/ui/action-result";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/fields";
import { Dialog, DialogContent } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

// The call page's actions, each shown only to the people allowed to use it and only in the state it applies
// to (the server decides both and checks them again). Every action reports in a toast and refreshes the page;
// the player in the layout above keeps playing through it.

export interface CallPermissions {
  /** Not yet a client or vendor call, and this person is an admin or on the line. */
  decide: boolean;
  /** Admins always; the line's people while the call is not business. */
  notWork: boolean;
  /** The other business type, when the call is business ("vendor" on a client call). */
  switchTo: "client" | "vendor" | null;
  retryTranscription: boolean;
  retryAnalysis: boolean;
  rerun: boolean;
}

function useCallAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (action: () => Promise<ActionResult<unknown>>, message: string | ((result: ActionResult<unknown>) => string)) =>
    start(async () => {
      const result = await action();
      if (!result.ok) {
        toast({ message: result.error, tone: "signal" });
        return;
      }
      toast({ message: typeof message === "string" ? message : message(result) });
      router.refresh();
    });
  return { pending, run };
}

/** "Not a work call": deletes the recording, transcript and any sheet and actions, after a plain warning. */
export function NotWorkDialog({ callId, open, onOpenChange }: { callId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pending, run } = useCallAction();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Not a work call?" description="This deletes the recording, transcript and any sheet and actions. It can't be undone.">
        <p className="text-[14px] leading-[20px] text-ink-2">Only a short note stays: the masked number, the line, the time and that you marked it.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await markCallNotWork(callId);
                if (result.ok) onOpenChange(false);
                return result;
              }, "Deleted as not a work call")
            }
          >
            <Trash size={16} aria-hidden="true" />
            {pending ? "Deleting…" : "Delete the call"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Which client?" for a client call: any active person may link or unlink it. */
export function LinkClientSelect({ callId, clientId, clients }: { callId: string; clientId: string | null; clients: ClientRef[] }) {
  const { pending, run } = useCallAction();
  return (
    <NativeSelect
      aria-label="Client"
      value={clientId ?? ""}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value || null;
        run(() => linkCallClient(callId, next), next ? `Linked to ${clients.find((c) => c.id === next)?.name ?? "the client"}` : "Unlinked from the client");
      }}
      className="h-9 bg-sheet lg:h-8 lg:text-[13px]"
    >
      <option value="">Link to a client…</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </NativeSelect>
  );
}

const decidedMessage = (type: "client" | "vendor") => (result: ActionResult<unknown>) =>
  result.ok && (result.data as { status?: string } | undefined)?.status === "ready" ? `Marked as a ${type} call. The sheet follows in a few minutes.` : `Marked as a ${type} call.`;

export function CallActions({ callId, can }: { callId: string; can: CallPermissions }) {
  const { pending, run } = useCallAction();
  const [deleting, setDeleting] = useState(false);
  const any = can.decide || can.notWork || can.switchTo || can.retryTranscription || can.retryAnalysis || can.rerun;
  if (!any) return <p className="text-ink-3">Nothing to do here.</p>;
  return (
    <div className="flex flex-col gap-2">
      {can.decide && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => run(() => decideCall(callId, "client"), decidedMessage("client"))}>
            Client call
          </Button>
          <Button size="sm" disabled={pending} onClick={() => run(() => decideCall(callId, "vendor"), decidedMessage("vendor"))}>
            Vendor call
          </Button>
        </div>
      )}
      {can.switchTo && (
        <Button size="sm" variant="ghost" className="justify-start" disabled={pending} onClick={() => run(() => setCallType(callId, can.switchTo!), `Changed to a ${can.switchTo} call`)}>
          <ArrowsClockwise size={16} aria-hidden="true" />
          Change to a {can.switchTo} call
        </Button>
      )}
      {can.retryTranscription && (
        <Button size="sm" variant="ghost" className="justify-start" disabled={pending} onClick={() => run(() => retryCallTranscription(callId), "Transcription queued; the next run takes it within 2 minutes")}>
          <ArrowClockwise size={16} aria-hidden="true" />
          Retry transcription
        </Button>
      )}
      {can.retryAnalysis && (
        <Button size="sm" variant="ghost" className="justify-start" disabled={pending} onClick={() => run(() => retryCallAnalysis(callId), "Queued for analysis; a run starts now")}>
          <ArrowClockwise size={16} aria-hidden="true" />
          Retry analysis
        </Button>
      )}
      {can.rerun && (
        <Button size="sm" variant="ghost" className="justify-start" disabled={pending} onClick={() => run(() => rerunCall(callId), "Queued for another run; this sheet stays until the new one lands")}>
          <ArrowClockwise size={16} aria-hidden="true" />
          Re-run the sheet
        </Button>
      )}
      {can.notWork && (
        <>
          <Button size="sm" variant="danger" className="justify-start" disabled={pending} onClick={() => setDeleting(true)}>
            <Trash size={16} aria-hidden="true" />
            Not a work call…
          </Button>
          <NotWorkDialog callId={callId} open={deleting} onOpenChange={setDeleting} />
        </>
      )}
    </div>
  );
}

/** The failed note's one button: the stage that failed decides which retry it is. */
export function RetryButton({ callId, kind }: { callId: string; kind: "transcription" | "analysis" }) {
  const { pending, run } = useCallAction();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() => run(() => (kind === "transcription" ? retryCallTranscription(callId) : retryCallAnalysis(callId)), kind === "transcription" ? "Transcription queued; the next run takes it within 2 minutes" : "Queued for analysis; a run starts now")}
    >
      <ArrowClockwise size={16} aria-hidden="true" />
      {pending ? "Queuing…" : kind === "transcription" ? "Retry transcription" : "Retry analysis"}
    </Button>
  );
}
