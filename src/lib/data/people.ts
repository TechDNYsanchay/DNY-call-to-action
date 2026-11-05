import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { PERSON_COLUMNS, type PersonSummary } from "./types";

/** Active DNY people, for the assign popover; every signed-in person may read the team list. */
export async function listActivePeople(): Promise<PersonSummary[]> {
  const db = await supabaseServer();
  const { data, error } = await db.from("people").select(PERSON_COLUMNS).eq("active", true).order("full_name");
  if (error) throw new Error(`people: ${error.message}`);
  return data ?? [];
}

/** Everyone on the team list, active or not, admins first (Settings > Team). */
export async function listAllPeople(): Promise<PersonSummary[]> {
  const db = await supabaseServer();
  const { data, error } = await db.from("people").select(PERSON_COLUMNS).order("role").order("full_name");
  if (error) throw new Error(`people: ${error.message}`);
  return data ?? [];
}
