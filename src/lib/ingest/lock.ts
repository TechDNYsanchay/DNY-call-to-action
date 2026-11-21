// A soft lock per job in sync_state: taken by a compare-and-set on locked_until, freed by the job's own
// finally. A run the platform kills keeps it until locked_until passes, so the lock time must cover the
// longest run. Same compare-and-set as the tl;dv tick (src/lib/ingest/sync.ts keeps its own copy).

import type { Json } from "@/lib/supabase/database.types";
import type { Db } from "@/lib/supabase/server";

export interface LockedRow {
  last_synced_at: string | null;
  value: Json | null;
}

/** Takes the lock for `ms`; null when another run holds it. Returns the row's last sync time and value. */
export async function acquireLock(db: Db, key: string, ms: number, now: Date = new Date()): Promise<LockedRow | null> {
  const lockedUntil = new Date(now.getTime() + ms).toISOString();
  const { data, error } = await db
    .from("sync_state")
    .update({ locked_until: lockedUntil })
    .eq("key", key)
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .select("last_synced_at, value");
  if (error) throw new Error(`sync_state lock failed: ${error.message}`);
  if (data && data.length > 0) return data[0];
  // Either locked, or the row is missing (a fresh database): create it and proceed.
  const { data: row, error: readError } = await db.from("sync_state").select("key").eq("key", key).maybeSingle();
  if (readError) throw new Error(`sync_state read failed: ${readError.message}`);
  if (row) return null;
  const { error: insertError } = await db.from("sync_state").insert({ key, locked_until: lockedUntil });
  if (insertError) return null;
  return { last_synced_at: null, value: null };
}

export async function releaseLock(db: Db, key: string): Promise<void> {
  const { error } = await db.from("sync_state").update({ locked_until: null }).eq("key", key);
  if (error) throw new Error(`sync_state unlock failed: ${error.message}`);
}
