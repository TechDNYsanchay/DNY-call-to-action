import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Person } from "./require-user";
import * as core from "./people-admin-core";

// CONTRACT (owned by the auth module): team-list management used by the Settings > Team screen and
// by scripts/people.mts. Adding a person also creates (or links) their Supabase auth user, so sign-in
// works with sign-ups disabled. Callers must run requireAdmin() first: these write with the service role.
// The logic lives in people-admin-core.ts (no server-only import) so the script can share it.
export interface NewPerson {
  email: string;
  fullName: string;
  role: "admin" | "member";
  dept?: string | null;
}

export async function addPerson(input: NewPerson): Promise<Person> {
  return core.addPerson(supabaseAdmin(), input);
}

/** Row inactive and auth user banned: pages stop at once, refresh tokens stop within the hour. */
export async function deactivatePerson(email: string): Promise<void> {
  await core.deactivatePerson(supabaseAdmin(), email);
}

export async function reactivatePerson(email: string): Promise<void> {
  await core.reactivatePerson(supabaseAdmin(), email);
}

/** A one-time sign-in link for local testing (no email is sent). */
export async function generateTestLink(email: string, redirectTo: string): Promise<string> {
  return core.generateTestLink(supabaseAdmin(), email, redirectTo);
}

/** Everyone on the team list, active or not, admins first. */
export async function listPeople(): Promise<Person[]> {
  return core.listPeople(supabaseAdmin());
}
