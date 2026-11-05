import "server-only";
import { istDate, secondsFrom } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadMeetingContext, type MeetingContext } from "./load";
import { matchItems, type ExistingItem } from "./match-items";
import { type ActionItem, PROMPT_VERSION, SheetSchema } from "./schema";
import { logAgentRun, logPipelineEvent } from "./settings";
import { countsOf, type SheetCounts, splitModel } from "./sheet-body";
import { bestMatch } from "./text";
import { type CheckContext, type CheckResult, checkSheet } from "./verify";
import { zodIssues } from "./zod-issues";

type ActionItemRow = Database["public"]["Tables"]["action_items"]["Row"];
type ActionItemInsert = Database["public"]["Tables"]["action_items"]["Insert"];

export type SaveOutcome =
  | { ok: false; errors: string[]; warnings: string[] }
  | { ok: true; saved: boolean; version: number | null; headline: string; counts: SheetCounts; warnings: string[] };

/** What the sheet row carries besides the model's output, so the UI can show approximate evidence. */
export interface SheetVerification {
  prompt_version: string;
  checked_at: string;
  warnings: string[];
  evidence_verified: Record<string, boolean>;
  adjusted_confidence: Record<string, number>;
}

export const checkContextOf = (ctx: MeetingContext): CheckContext => ({
  turns: ctx.turns,
  durationSec: ctx.meeting.duration_sec,
  meetingDateIst: istDate(ctx.meeting.happened_at),
  participantNames: [...ctx.participants.map((p) => p.name).filter((n): n is string => !!n), ...ctx.roster.map((r) => r.full_name)],
  speakerLabels: [...new Set(ctx.turns.map((t) => t.speaker))],
});

const firstEvidenceSec = (item: ActionItem): number | null => secondsFrom(item.evidence[0]?.timestamp ?? "");

function ownerEmail(name: string | null, ctx: MeetingContext): string | null {
  if (!name) return null;
  const p = bestMatch(name, ctx.participants, (c) => c.name);
  if (p) return p.email;
  return bestMatch(name, ctx.roster, (r) => r.full_name)?.email ?? null;
}

function itemRow(item: ActionItem, key: string, position: number, existing: ActionItemRow | null, sheetId: string, ctx: MeetingContext, check: CheckResult): ActionItemInsert {
  const ev = item.evidence[0];
  return {
    meeting_id: ctx.meeting.id,
    sheet_id: sheetId,
    item_key: key,
    position,
    title: item.title,
    details: item.details,
    owed_by: item.owed_by,
    owner_name: item.owner.name,
    owner_email: ownerEmail(item.owner.name, ctx),
    owner_basis: item.owner.basis,
    due_date: item.due.date,
    due_kind: item.due.kind,
    due_phrase: item.due.raw_phrase,
    priority: item.priority,
    // A row that came back after being dropped reopens; done or in-progress rows keep their state.
    status: existing && existing.status !== "superseded" && existing.status !== "dropped" ? existing.status : "open",
    evidence_ts_sec: ev ? secondsFrom(ev.timestamp) : null,
    evidence_speaker: ev?.speaker ?? null,
    evidence_quote: ev?.quote ?? null,
    evidence_verified: check.evidenceDetails[item.id]?.[0] ?? false,
    confidence: check.adjustedConfidence[item.id] ?? item.confidence,
    linked_decision: item.linked_decision_id,
  };
}

/**
 * Validate a sheet against the schema and the transcript, then store it as a new version with its
 * action items. With dryRun nothing is written; the routine uses that to fix its errors first.
 */
export async function saveSheet(meetingId: string, json: unknown, { dryRun }: { dryRun: boolean }): Promise<SaveOutcome> {
  const { sheet: raw, model } = splitModel(json);
  const parsed = SheetSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: zodIssues(parsed.error), warnings: [] };
  const sheet = parsed.data;

  const ctx = await loadMeetingContext(meetingId);
  if (!ctx) return { ok: false, errors: ["Meeting not found"], warnings: [] };
  if (!ctx.turns.length) return { ok: false, errors: ["No transcript is stored for this meeting; release it and move on"], warnings: [] };
  const attempt = ctx.meeting.process_attempts;

  const check = checkSheet(sheet, checkContextOf(ctx));
  if (check.errors.length) {
    if (!dryRun) await logAgentRun(meetingId, "extract", "rejected", attempt, `Sheet rejected: ${check.errors.length} errors`, { errors: check.errors, warnings: check.warnings });
    return { ok: false, errors: check.errors, warnings: check.warnings };
  }
  const counts = countsOf(sheet);
  if (dryRun) return { ok: true, saved: false, version: null, headline: sheet.headline, counts, warnings: check.warnings };

  const db = supabaseAdmin();
  const [{ data: existingRows, error: existingError }, { data: latest, error: latestError }] = await Promise.all([
    db.from("action_items").select("*").eq("meeting_id", meetingId),
    db.from("sheets").select("version").eq("meeting_id", meetingId).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (existingError || latestError) return { ok: false, errors: [existingError?.message ?? latestError?.message ?? "Database error"], warnings: check.warnings };
  const existing = (existingRows ?? []) as ActionItemRow[];
  const version = (latest?.version ?? 0) + 1;

  // Everything is decided before the first write: which rows are reused, which are superseded.
  const outcome = matchItems(sheet.action_items, existing as ExistingItem[], firstEvidenceSec);
  const byId = new Map(existing.map((r) => [r.id, r]));
  const verification: SheetVerification = {
    prompt_version: PROMPT_VERSION,
    checked_at: new Date().toISOString(),
    warnings: check.warnings,
    evidence_verified: check.evidenceVerified,
    adjusted_confidence: check.adjustedConfidence,
  };

  const { data: sheetRow, error: sheetError } = await db
    .from("sheets")
    .insert({ meeting_id: meetingId, version, status: "ready", headline: sheet.headline, result: { ...sheet, verification } as never, model, prompt_version: PROMPT_VERSION })
    .select("id")
    .single();
  if (sheetError || !sheetRow) {
    await logAgentRun(meetingId, "extract", "error", attempt, `Could not store the sheet: ${sheetError?.message ?? "no row"}`);
    return { ok: false, errors: [`Could not store the sheet: ${sheetError?.message ?? "no row returned"}`], warnings: check.warnings };
  }

  // Rows a person edited keep their text: only their place in the new version changes.
  const editedReused = outcome.matches.filter((m) => m.existing && byId.get(m.existing.id)?.edited_by);
  const rows = outcome.matches
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !(m.existing && byId.get(m.existing.id)?.edited_by))
    .map(({ m, i }) => itemRow(m.item, m.key, i, m.existing ? byId.get(m.existing.id) ?? null : null, sheetRow.id, ctx, check));

  const failure = await (async (): Promise<string | null> => {
    if (rows.length) {
      const { error } = await db.from("action_items").upsert(rows, { onConflict: "meeting_id,item_key" });
      if (error) return error.message;
    }
    for (const m of editedReused) {
      const { error } = await db.from("action_items").update({ sheet_id: sheetRow.id, position: outcome.matches.indexOf(m) }).eq("id", m.existing!.id);
      if (error) return error.message;
    }
    if (outcome.supersededIds.length) {
      const { error } = await db.from("action_items").update({ status: "superseded" }).in("id", outcome.supersededIds);
      if (error) return error.message;
    }
    const { error: oldSheets } = await db.from("sheets").update({ status: "superseded" }).eq("meeting_id", meetingId).lt("version", version);
    if (oldSheets) return oldSheets.message;
    const { error: meetingError } = await db
      .from("meetings")
      .update({
        process_status: "done",
        claimed_at: null,
        failure_reason: null,
        // A sheet exists, so this was a client meeting; only fill the type when nobody has set it.
        ...(ctx.meeting.type === "unknown" ? { type: "client" as const, type_source: "llm" as const } : {}),
      })
      .eq("id", meetingId);
    return meetingError?.message ?? null;
  })();

  if (failure) {
    // Roll back to the previous version: drop the new sheet row (items fall back to sheet_id null
    // and are repaired by the next successful save) and reinstate the latest older sheet.
    await db.from("sheets").delete().eq("id", sheetRow.id);
    await db.from("sheets").update({ status: "ready" }).eq("meeting_id", meetingId).eq("version", version - 1);
    await logAgentRun(meetingId, "extract", "error", attempt, `Save failed and was rolled back: ${failure}`);
    return { ok: false, errors: [`Could not store the sheet: ${failure}. Nothing was saved; try again.`], warnings: check.warnings };
  }

  const summary = `Sheet v${version} saved: ${counts.dny} for DNY, ${counts.client} for the client, ${counts.decisions} decisions` + (outcome.keptIds.length ? `; ${outcome.keptIds.length} edited items kept` : "");
  await logAgentRun(meetingId, "extract", "ok", attempt, summary, check.warnings.length ? { warnings: check.warnings } : undefined);
  await logPipelineEvent(meetingId, "info", "extract", summary);
  return { ok: true, saved: true, version, headline: sheet.headline, counts, warnings: check.warnings };
}
