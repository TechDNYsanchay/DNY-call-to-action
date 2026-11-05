"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addPersonAction, setPersonActive } from "@/app/(app)/settings/actions";
import type { PersonSummary } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field, Input, NativeSelect } from "@/components/ui/fields";
import { useToast } from "@/components/ui/toast";

// Settings > Team: the dense people table with deactivate / reactivate, and the add-person form.
// The signed-in admin's own row has no deactivate button.

export function TeamTable({ people, selfEmail }: { people: PersonSummary[]; selfEmail: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  const toggle = (p: PersonSummary) =>
    start(async () => {
      setBusy(p.email);
      const result = await setPersonActive(p.email, !p.active);
      setBusy(null);
      if (!result.ok) return toast({ message: result.error, tone: "signal" });
      toast({ message: p.active ? `${p.full_name} can no longer sign in` : `${p.full_name} can sign in again` });
      router.refresh();
    });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead>
          <tr className="text-left">
            {["Name", "Email", "Role", "Department", "Access", ""].map((h) => (
              <th key={h} className="label-xs border-b border-hairline px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {people.map((p) => (
            <tr key={p.id} className={clsx(!p.active && "text-ink-3")}>
              <td className="px-3 py-2 font-medium text-ink">
                {p.full_name}
                {p.email === selfEmail && <span className="ml-1.5 text-[11px] font-normal text-ink-3">you</span>}
              </td>
              <td className="px-3 py-2 font-mono text-[12px]">{p.email}</td>
              <td className="px-3 py-2">{p.role === "admin" ? <Chip tone="slate">admin</Chip> : "member"}</td>
              <td className="px-3 py-2">{p.dept ?? "—"}</td>
              <td className="px-3 py-2">{p.active ? "active" : "deactivated"}</td>
              <td className="px-3 py-1 text-right">
                {p.email !== selfEmail && (
                  <Button size="sm" variant={p.active ? "ghost" : "secondary"} onClick={() => toggle(p)} disabled={busy === p.email}>
                    {p.active ? "Deactivate" : "Reactivate"}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AddPersonForm() {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (form: FormData) =>
    start(async () => {
      setError(null);
      const result = await addPersonAction({ email: String(form.get("email") ?? ""), fullName: String(form.get("name") ?? ""), role: String(form.get("role") ?? "member"), dept: String(form.get("dept") ?? "") });
      if (!result.ok) return setError(result.error);
      toast({ message: "Added. They can sign in with Google or an email link now." });
      (document.getElementById("add-person-form") as HTMLFormElement | null)?.reset();
      router.refresh();
    });

  return (
    <form id="add-person-form" action={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_140px_140px_auto] sm:items-end">
      <Field label="Full name" htmlFor="person-name">
        <Input id="person-name" name="name" required maxLength={120} autoComplete="off" />
      </Field>
      <Field label="Email" htmlFor="person-email" hint="A dnyhospitality.com address">
        <Input id="person-email" name="email" type="email" required autoComplete="off" />
      </Field>
      <Field label="Role" htmlFor="person-role">
        <NativeSelect id="person-role" name="role" defaultValue="member">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </NativeSelect>
      </Field>
      <Field label="Department" htmlFor="person-dept">
        <Input id="person-dept" name="dept" maxLength={60} />
      </Field>
      <Button type="submit" variant="primary" disabled={pending} className="h-11 lg:h-9">
        {pending ? "Adding…" : "Add"}
      </Button>
      {error && (
        <p role="alert" className="text-[13px] text-signal sm:col-span-5">
          {error}
        </p>
      )}
    </form>
  );
}
