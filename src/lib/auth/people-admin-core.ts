// Team-list management against any service-role client. Kept free of "server-only" and next/*
// imports so scripts/people.mts can run it from the command line; src/lib/auth/people-admin.ts is
// the server-only facade the Settings > Team screen uses.
//
// Why both an auth user and a people row: sign-ups are closed in Supabase, so an auth user has to be
// created by an admin before Google or an email link can sign the person in; the people row is what
// actually grants access (currentPerson() checks it on every request).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

export type AdminDb = SupabaseClient<Database>;
export type PersonRow = Database["public"]["Tables"]["people"]["Row"];
export type PersonRole = Database["public"]["Enums"]["person_role"];

export interface NewPersonInput {
  email: string;
  fullName: string;
  role: PersonRole;
  dept?: string | null;
}

export const ROLES: readonly PersonRole[] = ["admin", "member"];

/** A ban long enough to outlive any refresh token; "none" lifts it. (876000 h is about 100 years.) */
export const BAN_FOREVER = "876000h";

/** How many auth users to read per page when looking one up; gotrue's upper bound. */
const USERS_PER_PAGE = 1000;

/** Lower-cased, trimmed address; throws in plain words when it is not an address at all. */
export function normaliseEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${raw}" is not an email address`);
  return email;
}

/** The people row fields for an addPerson call, validated and tidied. */
export function normaliseNewPerson(input: NewPersonInput): { email: string; full_name: string; role: PersonRole; dept: string | null } {
  const full_name = input.fullName.trim().replace(/\s+/g, " ");
  if (!full_name) throw new Error("A full name is required");
  if (!ROLES.includes(input.role)) throw new Error(`Role must be one of: ${ROLES.join(", ")}`);
  const dept = input.dept?.trim() || null;
  return { email: normaliseEmail(input.email), full_name, role: input.role, dept };
}

/**
 * The link a tester opens locally: our own /auth/callback with the hashed token, so no email is
 * needed. redirectTo may already carry ?next=..., hence the join character.
 */
export function testLinkUrl(redirectTo: string, hashedToken: string, type = "magiclink"): string {
  const join = redirectTo.includes("?") ? "&" : "?";
  return `${redirectTo}${join}token_hash=${encodeURIComponent(hashedToken)}&type=${encodeURIComponent(type)}`;
}

/** The auth user id for an address, paging through the admin list; null when there is none. */
export async function findAuthUserId(db: AdminDb, email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) throw new Error(`list auth users: ${error.message}`);
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user.id;
    if (data.users.length < USERS_PER_PAGE) return null;
  }
}

/** Creates the auth user for an address (confirmed, no email sent) or finds the existing one. */
export async function ensureAuthUser(db: AdminDb, email: string): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (!error) return data.user.id;
  const duplicate = error.code === "email_exists" || /already (been )?registered|already exists/i.test(error.message);
  if (!duplicate) throw new Error(`create auth user for ${email}: ${error.message}`);
  const existing = await findAuthUserId(db, email);
  if (!existing) throw new Error(`create auth user for ${email}: Supabase says the address exists but it was not found`);
  return existing;
}

async function personByEmail(db: AdminDb, email: string): Promise<PersonRow | null> {
  const { data, error } = await db.from("people").select("*").eq("email", email).maybeSingle();
  if (error) throw new Error(`find person ${email}: ${error.message}`);
  return data;
}

/** Adds someone to the team list (or updates them) and makes sure they have a login. */
export async function addPerson(db: AdminDb, input: NewPersonInput): Promise<PersonRow> {
  const fields = normaliseNewPerson(input);
  const authUserId = await ensureAuthUser(db, fields.email);
  // Adding again re-activates and updates; a previous ban is lifted too so the login works at once.
  const existing = await personByEmail(db, fields.email);
  const row = { ...fields, auth_user_id: authUserId, active: true };
  const result = existing
    ? await db.from("people").update(row).eq("id", existing.id).select("*").single()
    : await db.from("people").insert(row).select("*").single();
  if (result.error) throw new Error(`${existing ? "update" : "add"} person ${fields.email}: ${result.error.message}`);
  if (existing && !existing.active) await setBan(db, authUserId, false);
  return result.data;
}

async function setBan(db: AdminDb, authUserId: string, banned: boolean): Promise<void> {
  const { error } = await db.auth.admin.updateUserById(authUserId, { ban_duration: banned ? BAN_FOREVER : "none" });
  if (error) throw new Error(`${banned ? "ban" : "unban"} auth user: ${error.message}`);
}

/**
 * Removes access: the row goes inactive (every request re-checks it, so pages stop at once) and the
 * auth user is banned so its refresh tokens stop working within the hour.
 */
export async function deactivatePerson(db: AdminDb, rawEmail: string): Promise<PersonRow> {
  const email = normaliseEmail(rawEmail);
  const person = await personByEmail(db, email);
  if (!person) throw new Error(`No one on the team list has the address ${email}`);
  const { data, error } = await db.from("people").update({ active: false }).eq("id", person.id).select("*").single();
  if (error) throw new Error(`deactivate ${email}: ${error.message}`);
  const authUserId = person.auth_user_id ?? (await findAuthUserId(db, email));
  if (authUserId) await setBan(db, authUserId, true);
  return data;
}

/** Reverses deactivatePerson: row active again, ban lifted, login created if it never existed. */
export async function reactivatePerson(db: AdminDb, rawEmail: string): Promise<PersonRow> {
  const email = normaliseEmail(rawEmail);
  const person = await personByEmail(db, email);
  if (!person) throw new Error(`No one on the team list has the address ${email}`);
  const authUserId = person.auth_user_id ?? (await ensureAuthUser(db, email));
  await setBan(db, authUserId, false);
  const { data, error } = await db.from("people").update({ active: true, auth_user_id: authUserId }).eq("id", person.id).select("*").single();
  if (error) throw new Error(`reactivate ${email}: ${error.message}`);
  return data;
}

/** A one-time sign-in link on our own callback, for local testing without email. */
export async function generateTestLink(db: AdminDb, rawEmail: string, redirectTo: string): Promise<string> {
  const email = normaliseEmail(rawEmail);
  const person = await personByEmail(db, email);
  if (!person?.active) throw new Error(`${email} is not an active person on the team list, so a link would not let them in`);
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
  if (error) throw new Error(`generate link for ${email}: ${error.message}`);
  return testLinkUrl(redirectTo, data.properties.hashed_token, data.properties.verification_type);
}

/** Everyone on the list, admins first, then by name. */
export async function listPeople(db: AdminDb): Promise<PersonRow[]> {
  const { data, error } = await db.from("people").select("*").order("role").order("full_name");
  if (error) throw new Error(`list people: ${error.message}`);
  return data;
}
