import "server-only";
import { redirect } from "next/navigation";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

export type Person = Database["public"]["Tables"]["people"]["Row"];

/**
 * The signed-in person on the team list, or null. Signed in but not on the list also gives null:
 * Google only proves who someone is; an active row in `people` is what grants access.
 */
export async function currentPerson(): Promise<Person | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const admin = supabaseAdmin();
  const { data: person } = await admin.from("people").select("*").eq("auth_user_id", claims.sub).eq("active", true).maybeSingle();
  if (person) return person;
  // The row was added after the account existed (or the trigger has not linked it yet): link by email.
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  if (!email) return null;
  const { data: linked } = await admin
    .from("people")
    .update({ auth_user_id: claims.sub })
    .eq("email", email)
    .eq("active", true)
    .is("auth_user_id", null)
    .select("*")
    .maybeSingle();
  return linked ?? null;
}

/** Whether anyone is signed in at all (team member or not). */
export async function isSignedIn(): Promise<boolean> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  return Boolean(data?.claims?.sub);
}

/**
 * Call first in every signed-in page and server action. Not signed in -> /login; signed in but not on
 * the team list -> /denied. Returns the person and whether they are an admin.
 */
export async function requireUser(): Promise<{ person: Person; isAdmin: boolean }> {
  const person = await currentPerson();
  if (!person) redirect((await isSignedIn()) ? "/denied" : "/login");
  return { person, isAdmin: person.role === "admin" };
}

/** Like requireUser, but only admins pass; others are sent to the inbox. */
export async function requireAdmin(): Promise<{ person: Person; isAdmin: true }> {
  const { person, isAdmin } = await requireUser();
  if (!isAdmin) redirect("/meetings");
  return { person, isAdmin: true };
}
