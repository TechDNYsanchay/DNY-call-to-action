// Deleting a call that is not a work call (or has no speech, or nobody confirmed in time), and removing
// recordings from the private bucket. purge_call (SQL) does the database side in one transaction: it
// deletes the transcript, sheets, items and notes, keeps a stub with the masked number and a fixed reason,
// marks the audio deleted and queues its object in storage_deletions. The object is then removed at once;
// when that fails, every calls run (and the nightly retention) drains the queue until it is gone.

import type { Db } from "@/lib/supabase/server";
import { errorText, pgErrorText, sanitizeForLog } from "./sanitize";
import { skipReason, type SkipCode } from "./skip";

export type { SkipCode } from "./skip";

export const RECORDINGS_BUCKET = "call-recordings";
/**
 * Queue rows per delete or update. `.in("path", …)` puts the paths in the URL, and the gateway answers 414
 * once the request line passes 8 KB (about 125 paths on the local stack); 50 paths are about 3.2 KB.
 */
export const QUEUE_WRITE_CHUNK = 50;

/** Removes objects from the private bucket in one request. Never throws; the error text is sanitised. */
export async function removeRecordingObjects(db: Db, paths: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!paths.length) return { ok: true };
  try {
    const { error } = await db.storage.from(RECORDINGS_BUCKET).remove(paths);
    return error ? { ok: false, error: sanitizeForLog(error.message || "storage removal failed") } : { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/** Why purge_claimed_call refused the routine's purge; nothing was deleted. */
export type PurgeRefusal = "claim_mismatch" | "human_label" | "has_sheet" | "call_not_found";
const PURGE_REFUSALS: readonly PurgeRefusal[] = ["claim_mismatch", "human_label", "has_sheet", "call_not_found"];

/**
 * Purges a call. `purged` is false when it was already purged; `mediaRemoved` is true once no object is
 * left in the bucket (removed now, or none was stored). The fixed reason comes from skipReason; a person's
 * "Not a work call" names them. With `claim` (the routine, on the call it claimed) the checks run in the
 * purge's own transaction (purge_claimed_call): still processing under that claim, no person's client or
 * vendor label, no sheet; a failed check comes back as `refused` and deletes nothing.
 */
export async function purgeCall(
  db: Db,
  meetingId: string,
  code: SkipCode,
  opts: { by: "routine" | "person" | "system"; byName?: string; summary?: string; remove?: (path: string) => Promise<boolean>; claim?: string },
): Promise<{ purged: boolean; mediaRemoved: boolean; refused?: PurgeRefusal }> {
  const { data: before, error: readError } = await db.from("phone_calls").select("purged_at").eq("meeting_id", meetingId).maybeSingle();
  if (readError) throw new Error(`phone_calls read failed: ${pgErrorText(readError)}`);
  if (before?.purged_at) return { purged: false, mediaRemoved: false };
  const args = {
    p_meeting_id: meetingId,
    p_code: code,
    p_reason: skipReason(code, opts.byName),
    ...(opts.summary ? { p_summary: sanitizeForLog(opts.summary) } : {}),
  };
  const { data: path, error } = opts.claim ? await db.rpc("purge_claimed_call", { ...args, p_claim: opts.claim }) : await db.rpc("purge_call", { ...args, p_by: opts.by });
  if (error) {
    const refused = opts.claim ? PURGE_REFUSALS.find((r) => r === error.message) : undefined;
    if (refused) return { purged: false, mediaRemoved: false, refused };
    throw new Error(`purge_call failed: ${pgErrorText(error)}`);
  }
  if (!path) return { purged: true, mediaRemoved: true };
  const removed = opts.remove ? await opts.remove(path).catch(() => false) : (await removeRecordingObjects(db, [path])).ok;
  if (!removed) return { purged: true, mediaRemoved: false };
  // The object is gone; a queue row left behind only makes the next drain remove nothing.
  await db.from("storage_deletions").delete().eq("path", path);
  return { purged: true, mediaRemoved: true };
}

/**
 * Removes the oldest `limit` queued objects in one request. On success their queue rows are deleted;
 * on failure each row records the (sanitised) error and when it was tried, and stays for the next drain.
 * The rows are written QUEUE_WRITE_CHUNK at a time. `removed` counts paths whose object is gone and whose
 * row was deleted; `failed` counts paths still queued: the removal failed, or their rows' delete did.
 */
export async function drainStorageDeletions(
  db: Db,
  opts: { limit: number; remove?: (paths: string[]) => Promise<{ ok: boolean; error?: string }> },
): Promise<{ removed: number; failed: number }> {
  const { data, error } = await db.from("storage_deletions").select("path").order("created_at", { ascending: true }).limit(opts.limit);
  if (error) throw new Error(`storage_deletions read failed: ${pgErrorText(error)}`);
  const paths = (data ?? []).map((row) => row.path);
  if (!paths.length) return { removed: 0, failed: 0 };
  const result = await (opts.remove ?? ((p: string[]) => removeRecordingObjects(db, p)))(paths).catch((e: unknown) => ({ ok: false, error: errorText(e) }));
  const failure = result.ok ? null : { last_error: sanitizeForLog(result.error ?? "storage removal failed"), last_tried_at: new Date().toISOString() };
  let removed = 0;
  for (let i = 0; i < paths.length; i += QUEUE_WRITE_CHUNK) {
    const chunk = paths.slice(i, i + QUEUE_WRITE_CHUNK);
    // Already removed objects are skipped by the storage API, so rows that survive a failed delete are
    // harmless: the next drain removes nothing and deletes them.
    const queue = db.from("storage_deletions");
    const { error: writeError } = failure ? await queue.update(failure).in("path", chunk) : await queue.delete().in("path", chunk);
    if (writeError) console.error(`storage_deletions: ${failure ? "recording a failed removal on" : "deleting"} ${chunk.length} rows failed: ${pgErrorText(writeError)}`);
    else if (!failure) removed += chunk.length;
  }
  return { removed, failed: paths.length - removed };
}
