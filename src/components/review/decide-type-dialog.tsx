"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { type DecisionType, decideMeetingType } from "@/app/(app)/review/actions";
import type { ClientRef } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/fields";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

// "What is this meeting?" One dialog for the review queue, the banner and the context rail.
// Client meeting asks which client (existing or new) and whether to remember the domains.

export const TYPE_OPTIONS: Array<{ type: DecisionType; label: string; hint: string }> = [
  { type: "client", label: "Client meeting", hint: "DNY already serves this party. A sheet will be written." },
  { type: "sales", label: "Sales meeting", hint: "A prospect. Left to the sales agent." },
  { type: "internal", label: "Internal", hint: "Only DNY people. No sheet." },
  { type: "other", label: "Other", hint: "Vendor, recruitment, personal or no content." },
];

export interface DecideTypeProps {
  meetingId: string;
  currentType: string;
  currentClientId?: string | null;
  clients: ClientRef[];
  /** External (non-DNY) domains and personal addresses seen on the invite, for the remember checkbox. */
  external: string[];
  clientNameGuess?: string | null;
  initialType?: DecisionType;
  onDecided?: (type: DecisionType) => void;
}

export function DecideTypeDialog({ trigger, ...props }: DecideTypeProps & { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="What is this meeting?" description="A person's answer is final: later runs never change it.">
        <DecideTypeForm
          {...props}
          onDecided={(type) => {
            setOpen(false);
            props.onDecided?.(type);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function DecideTypeForm({ meetingId, currentType, currentClientId, clients, external, clientNameGuess, initialType, onDecided }: DecideTypeProps) {
  const router = useRouter();
  const toast = useToast();
  const [type, setType] = useState<DecisionType>(initialType ?? (currentType === "unknown" ? "client" : (currentType as DecisionType)));
  const [clientId, setClientId] = useState(currentClientId ?? "");
  const [newName, setNewName] = useState(clientNameGuess && !clients.some((c) => c.name.toLowerCase() === clientNameGuess.toLowerCase()) ? clientNameGuess : "");
  const [remember, setRemember] = useState(external.length > 0);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const creating = clientId === "__new__";

  const submit = () => {
    setError(null);
    start(async () => {
      const result = await decideMeetingType(meetingId, type, {
        clientId: type === "client" && !creating ? clientId || null : null,
        newClientName: type === "client" && creating ? newName : null,
        rememberDomain: type === "client" && remember,
        note,
      });
      if (!result.ok) return setError(result.error);
      toast({ message: type === "client" ? "Marked as a client meeting. It is queued for the next run." : `Marked as ${TYPE_OPTIONS.find((o) => o.type === type)?.label.toLowerCase()}.` });
      onDecided?.(type);
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Meeting type</legend>
        {TYPE_OPTIONS.map((o) => (
          <label key={o.type} className={clsx("flex cursor-pointer flex-col gap-0.5 rounded-card border p-3 transition-colors duration-150", type === o.type ? "border-ink bg-raised" : "border-hairline hover:border-strong")}>
            <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
              <input type="radio" name="type" value={o.type} checked={type === o.type} onChange={() => setType(o.type)} className="accent-[var(--ink)]" />
              {o.label}
            </span>
            <span className="pl-5 text-[12px] leading-4 text-ink-3">{o.hint}</span>
          </label>
        ))}
      </fieldset>

      {type === "client" && (
        <div className="flex flex-col gap-3 rounded-card bg-inset p-3">
          <Field label="Which client?" htmlFor="decide-client">
            <NativeSelect id="decide-client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="bg-sheet">
              <option value="">Not sure yet</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__new__">New client…</option>
            </NativeSelect>
          </Field>
          {creating && (
            <Field label="New client's name" htmlFor="decide-new-client">
              <Input id="decide-new-client" value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus className="bg-sheet" />
            </Field>
          )}
          {external.length > 0 && (clientId || creating) && (
            <label className="flex items-start gap-2 text-[13px] leading-[18px] text-ink-2">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 size-4 accent-[var(--ink)]" />
              <span>
                Remember <span className="font-mono text-[12px] text-ink">{external.join(", ")}</span> as this client from now on
              </span>
            </label>
          )}
        </div>
      )}

      <Field label="Note (optional)" htmlFor="decide-note">
        <Input id="decide-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>

      {error && (
        <p role="alert" className="text-[13px] text-signal">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="submit" variant="primary" disabled={pending || (type === "client" && creating && !newName.trim())}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
