"use client";

import { Buildings, Trash, Truck } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideCall } from "@/app/(app)/calls/[id]/actions";
import type { ClientRef } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect } from "@/components/ui/fields";
import { useToast } from "@/components/ui/toast";
import { NotWorkDialog } from "./call-actions";

// "Is this a work call?" for a call the routine was not sure about, or held for a person. Admins and the
// people on the call's line answer: a client call (with its client, when known), a vendor call, or not a work
// call, which deletes it. The answer is final; later runs never change it. A call in "Needs your decision" that
// still has a client or vendor label (none arises today: hold_call undoes a label the routine gave on an earlier
// run) says so, and starts from the client it linked; only admins may delete one of those.

export function CallDecision({
  callId,
  hint,
  clients,
  guess,
  defaultClientId,
  canDelete,
}: {
  callId: string;
  hint: string | null;
  clients: ClientRef[];
  /** The routine's label on a held call, when it had one. */
  guess: "client" | "vendor" | null;
  /** The client the call is linked to already, if any. */
  defaultClientId: string | null;
  /** "Not a work call" for this person: admins always, the line's people only while the call has no label. */
  canDelete: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [choosingClient, setChoosingClient] = useState(false);
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [deleting, setDeleting] = useState(false);

  const decide = (type: "client" | "vendor") =>
    start(async () => {
      const result = await decideCall(callId, type, type === "client" ? clientId || null : null);
      if (!result.ok) {
        toast({ message: result.error, tone: "signal" });
        return;
      }
      toast({ message: result.data?.status === "ready" ? `Marked as a ${type} call. The sheet follows in a few minutes.` : `Marked as a ${type} call.` });
      router.refresh();
    });

  return (
    <section aria-labelledby="decide-title" className="rounded-card border-l-[3px] border-l-sienna bg-inset px-4 py-4 sm:px-5">
      <p id="decide-title" className="text-[15px] font-semibold text-ink">
        Is this a work call?
      </p>
      {hint && <p className="mt-1 text-[14px] leading-[20px] text-ink-2">{hint}</p>}
      {guess && <p className="mt-1 text-[14px] leading-[20px] text-ink-2">The routine took it for a {guess} call.</p>}
      <p className="mt-1 text-[13px] leading-[18px] text-ink-3">Listen to it above or read the transcript below. Your answer is final; later runs never change it.</p>
      {choosingClient ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Which client?" htmlFor="decide-client" hint="Leave it if you are not sure; the sheet can name it." className="sm:min-w-[260px]">
            <NativeSelect id="decide-client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="bg-sheet">
              <option value="">Not sure yet</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" disabled={pending} onClick={() => decide("client")}>
              {pending ? "Saving…" : "Mark as a client call"}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setChoosingClient(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" disabled={pending} onClick={() => setChoosingClient(true)}>
            <Buildings size={16} aria-hidden="true" />
            Client call
          </Button>
          <Button disabled={pending} onClick={() => decide("vendor")}>
            <Truck size={16} aria-hidden="true" />
            Vendor call
          </Button>
          {canDelete && (
            <Button variant="danger" disabled={pending} onClick={() => setDeleting(true)}>
              <Trash size={16} aria-hidden="true" />
              Not a work call
            </Button>
          )}
        </div>
      )}
      {canDelete && <NotWorkDialog callId={callId} open={deleting} onOpenChange={setDeleting} />}
    </section>
  );
}
