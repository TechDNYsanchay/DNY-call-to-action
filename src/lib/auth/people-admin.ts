import "server-only";
import type { Person } from "./require-user";

// CONTRACT (owned by the auth module): team-list management used by the Settings > Team screen and
// by scripts/people.mts. Adding a person also creates (or links) their Supabase auth user, so sign-in
// works with sign-ups disabled.
export interface NewPerson {
  email: string;
  fullName: string;
  role: "admin" | "member";
  dept?: string | null;
}

export async function addPerson(input: NewPerson): Promise<Person> {
  void input;
  throw new Error("addPerson is not implemented yet");
}

export async function deactivatePerson(email: string): Promise<void> {
  void email;
  throw new Error("deactivatePerson is not implemented yet");
}

export async function reactivatePerson(email: string): Promise<void> {
  void email;
  throw new Error("reactivatePerson is not implemented yet");
}

/** A one-time sign-in link for local testing (no email is sent). */
export async function generateTestLink(email: string, redirectTo: string): Promise<string> {
  void email;
  void redirectTo;
  throw new Error("generateTestLink is not implemented yet");
}
