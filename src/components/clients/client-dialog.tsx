"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { saveClient } from "@/app/(app)/clients/actions";
import type { ClientSummary } from "@/lib/data/clients";
import { CLIENT_STATUSES } from "@/lib/ui/csv";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/fields";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

// Add or edit one client (admins). Domains and emails are typed one per line or comma separated.

export function ClientDialog({ client, trigger }: { client?: ClientSummary; trigger: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = client?.id ?? "new";

  const submit = (form: FormData) =>
    start(async () => {
      setError(null);
      const result = await saveClient({
        id: client?.id ?? null,
        name: String(form.get("name") ?? ""),
        domains: String(form.get("domains") ?? ""),
        contactEmails: String(form.get("emails") ?? ""),
        status: String(form.get("status") ?? "active"),
        notes: String(form.get("notes") ?? ""),
      });
      if (!result.ok) return setError(result.error);
      setOpen(false);
      toast({ message: client ? "Client updated" : "Client added" });
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={client ? `Edit ${client.name}` : "Add a client"} description="Invitees from these domains or addresses make a recording a client meeting automatically.">
        <form action={submit} className="flex flex-col gap-4">
          <Field label="Name" htmlFor={`client-name-${id}`}>
            <Input id={`client-name-${id}`} name="name" defaultValue={client?.name ?? ""} required maxLength={120} autoFocus />
          </Field>
          <Field label="Email domains" htmlFor={`client-domains-${id}`} hint="One per line or comma separated, e.g. tajhotels.com. Never gmail.com or other personal mailboxes.">
            <Textarea id={`client-domains-${id}`} name="domains" defaultValue={client?.domains.join("\n") ?? ""} className="min-h-[72px]" />
          </Field>
          <Field label="Contact emails" htmlFor={`client-emails-${id}`} hint="For contacts on personal mailboxes, e.g. rakesh@gmail.com.">
            <Textarea id={`client-emails-${id}`} name="emails" defaultValue={client?.contact_emails.join("\n") ?? ""} className="min-h-[72px]" />
          </Field>
          <Field label="Status" htmlFor={`client-status-${id}`}>
            <NativeSelect id={`client-status-${id}`} name="status" defaultValue={client?.status ?? "active"}>
              {CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Notes (optional)" htmlFor={`client-notes-${id}`}>
            <Textarea id={`client-notes-${id}`} name="notes" defaultValue={client?.notes ?? ""} className="min-h-[60px] font-sans text-[14px]" />
          </Field>
          {error && (
            <p role="alert" className="text-[13px] text-signal">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
