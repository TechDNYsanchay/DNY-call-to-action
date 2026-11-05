"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-user";
import { supabaseAdmin } from "@/lib/supabase/server";
import { type ActionResult, failed, ok } from "@/lib/ui/action-result";
import { type ClientStatus, DOMAIN, EMAIL, isClientStatus, normaliseList, parseClientsCsv } from "@/lib/ui/csv";

// Admin edits to the client list: one client from the dialog, or many from the CSV textarea.
// Both are validated the same way; the CSV import merges by name so a re-import never duplicates.

export interface ClientInput {
  id?: string | null;
  name: string;
  domains: string;
  contactEmails: string;
  status: string;
  notes?: string;
}

export async function saveClient(input: ClientInput): Promise<ActionResult<{ id: string }>> {
  try {
    await requireAdmin();
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!name) throw new Error("The client needs a name");
    const domains = normaliseList(input.domains);
    const contact_emails = normaliseList(input.contactEmails);
    const badDomain = domains.find((d) => !DOMAIN.test(d));
    if (badDomain) throw new Error(`"${badDomain}" is not a domain (expected something like tajhotels.com)`);
    const badEmail = contact_emails.find((e) => !EMAIL.test(e));
    if (badEmail) throw new Error(`"${badEmail}" is not an email address`);
    const status = input.status.trim().toLowerCase();
    if (!isClientStatus(status)) throw new Error("Status must be active, onboarding or churned");
    const notes = input.notes?.trim() || null;
    const db = supabaseAdmin();
    const row = { name, domains, contact_emails, status, notes };
    const result = input.id ? await db.from("clients").update(row).eq("id", input.id).select("id").single() : await db.from("clients").insert(row).select("id").single();
    if (result.error) throw new Error(result.error.message);
    revalidatePath("/clients");
    revalidatePath(`/clients/${result.data.id}`);
    return ok({ id: result.data.id });
  } catch (e) {
    return failed(e);
  }
}

export interface ImportSummary {
  created: number;
  updated: number;
  problems: Array<{ line: number; message: string }>;
}

/** Saves every valid line; existing clients (same name, any case) get the domains and emails merged in. */
export async function importClientsCsv(text: string): Promise<ActionResult<ImportSummary>> {
  try {
    await requireAdmin();
    const { rows, problems } = parseClientsCsv(text);
    if (!rows.length) throw new Error(problems.length ? "No line could be saved; fix the problems below" : "Paste at least one line");
    const db = supabaseAdmin();
    const { data: existing, error } = await db.from("clients").select("id, name, domains, contact_emails");
    if (error) throw new Error(error.message);
    const byName = new Map((existing ?? []).map((c) => [c.name.trim().toLowerCase(), c]));
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const match = byName.get(row.name.toLowerCase());
      if (match) {
        const patch = { domains: [...new Set([...match.domains, ...row.domains])], contact_emails: [...new Set([...match.contact_emails, ...row.contact_emails])], status: row.status as ClientStatus };
        const { error: uError } = await db.from("clients").update(patch).eq("id", match.id);
        if (uError) problems.push({ line: row.line, message: uError.message });
        else updated++;
      } else {
        const { error: iError } = await db.from("clients").insert({ name: row.name, domains: row.domains, contact_emails: row.contact_emails, status: row.status });
        if (iError) problems.push({ line: row.line, message: iError.message });
        else created++;
      }
    }
    revalidatePath("/clients");
    revalidatePath("/settings");
    return ok({ created, updated, problems: problems.sort((a, b) => a.line - b.line) });
  } catch (e) {
    return failed(e);
  }
}
