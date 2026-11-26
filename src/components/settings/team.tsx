"use client";

import { CaretDown, UserPlus } from "@phosphor-icons/react";
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

/**
 * One row on desktop (name, email, role, department, button), two columns on a tablet, stacked on a phone.
 * Every column starts with its label, so labels and fields line up whatever hint sits under a field; the
 * button column carries an empty label line for the same reason. Departments already in use are offered.
 */
export function AddPersonForm({ departments = [] }: { departments?: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (form: FormData) =>
    start(async () => {
      setError(null);
      const name = String(form.get("name") ?? "");
      const result = await addPersonAction({ email: String(form.get("email") ?? ""), fullName: name, role: String(form.get("role") ?? "member"), dept: String(form.get("dept") ?? "") });
      if (!result.ok) return setError(result.error);
      toast({ message: `${name.trim() || "Added"}: they can sign in with Google or an email link now.` });
      (document.getElementById("add-person-form") as HTMLFormElement | null)?.reset();
      router.refresh();
    });

  return (
    <form id="add-person-form" action={submit} className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_136px_minmax(0,0.85fr)_auto]">
      <Field label="Full name" htmlFor="person-name">
        <Input id="person-name" name="name" required maxLength={120} autoComplete="off" placeholder="e.g. Kaushalya Patil" className="bg-sheet" />
      </Field>
      <Field label="Email" htmlFor="person-email" hint="Must be a dnyhospitality.com address">
        <Input id="person-email" name="email" type="email" required autoComplete="off" placeholder="name@dnyhospitality.com" aria-describedby="person-email-hint" className="bg-sheet" />
      </Field>
      <Field label="Role" htmlFor="person-role">
        <div className="relative">
          <NativeSelect id="person-role" name="role" defaultValue="member" className="bg-sheet pr-9">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </NativeSelect>
          <CaretDown size={12} weight="bold" aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-3" />
        </div>
      </Field>
      <Field label="Department" htmlFor="person-dept">
        <Input id="person-dept" name="dept" maxLength={60} placeholder="e.g. Hospitality" list={departments.length ? "person-dept-options" : undefined} autoComplete="off" className="bg-sheet" />
        {departments.length > 0 && (
          <datalist id="person-dept-options">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        )}
      </Field>
      <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
        <span aria-hidden="true" className="hidden text-[13px] font-medium lg:block">
          &nbsp;
        </span>
        <Button type="submit" variant="primary" disabled={pending} className="h-11 w-full sm:ml-auto sm:w-auto sm:min-w-[132px] lg:h-9">
          <UserPlus size={16} aria-hidden="true" />
          {pending ? "Adding…" : "Add person"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-signal sm:col-span-2 lg:col-span-5">
          {error}
        </p>
      )}
    </form>
  );
}
