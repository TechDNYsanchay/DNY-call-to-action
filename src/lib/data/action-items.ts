import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { pgQuote } from "@/lib/ui/query";
import { type ActionItemRow, type ClientRef, ITEM_COLUMNS } from "./types";

// Open action items for one person, across meetings: matched by the owner email the save step
// resolved, or by the full name when the model only had a spoken name.

export interface MyItem extends ActionItemRow {
  meeting: { id: string; title: string | null; happened_at: string; client: ClientRef | null } | null;
}

export async function listMyItems(person: { email: string; full_name: string }): Promise<MyItem[]> {
  const db = await supabaseServer();
  const { data, error } = await db
    .from("action_items")
    .select(`${ITEM_COLUMNS}, meeting:meetings(id, title, happened_at, client:clients(id, name))`)
    .in("status", ["open", "in_progress"])
    .or(`owner_email.eq.${pgQuote(person.email.toLowerCase())},owner_name.eq.${pgQuote(person.full_name)}`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) throw new Error(`action_items: ${error.message}`);
  return (data ?? []) as MyItem[];
}
