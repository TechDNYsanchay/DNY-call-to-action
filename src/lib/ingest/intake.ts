import "server-only";

// Intake: what a tl;dv meeting and its transcript become in the database. Idempotent on
// tldv_meeting_id, so the webhook, the cron and a manual replay can all call it for the same meeting.
// The decisions live in ./decisions.ts and ./rules.ts; this file only reads and writes rows.

import type { Json } from "@/lib/supabase/database.types";
import { supabaseAdmin, type Db } from "@/lib/supabase/server";
import type { TldvMeeting } from "@/lib/tldv/parse";
import { wordCount, type SpeakerTurn } from "@/lib/tldv/turns";
import {
  countSentences,
  metadataColumns,
  participantRows,
  planAfterTranscript,
  planAfterUpsert,
  speakerLabelsReliable,
  statusAfterWaiting,
  type MeetingSource,
  type MeetingState,
  type ProcessStatus,
} from "./decisions";
import { applyRules, type ClientLike } from "./rules";

export type EventLevel = "info" | "warn" | "error";

const STATE_COLUMNS = "id, type, type_source, process_status, transcript_ready, duration_sec, title, meet_code";

type StateRow = MeetingState & { id: string; duration_sec: number; title: string | null; meet_code: string | null };

interface BookingRef {
  id: string;
  clientId: string | null;
  meetingId: string | null;
}

/** One line in pipeline_events. Never pass transcript text. Logging must never break the pipeline. */
export async function logEvent(level: EventLevel, step: string, message: string, meetingId?: string | null): Promise<void> {
  const { error } = await supabaseAdmin().from("pipeline_events").insert({ level, step, message: message.slice(0, 1000), meeting_id: meetingId ?? null });
  if (error) console.error(`pipeline_events insert failed (${step}): ${error.message}`);
  if (level === "error") console.error(`[${step}] ${message}`);
  else if (level === "warn") console.warn(`[${step}] ${message}`);
}

async function loadClients(db: Db): Promise<ClientLike[]> {
  const { data, error } = await db.from("clients").select("id, name, domains, contact_emails");
  if (error) throw new Error(`clients read failed: ${error.message}`);
  return data ?? [];
}

async function loadState(db: Db, filter: { id?: string; tldvMeetingId?: string }): Promise<StateRow | null> {
  let query = db.from("meetings").select(STATE_COLUMNS);
  query = filter.id ? query.eq("id", filter.id) : query.eq("tldv_meeting_id", filter.tldvMeetingId!);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`meetings read failed: ${error.message}`);
  return data;
}

/** The booking made in this app for a Meet code, if any (whatever its status: the code is unique). */
async function loadBooking(db: Db, meetCode: string | null): Promise<BookingRef | null> {
  if (!meetCode) return null;
  const { data, error } = await db.from("client_meeting_bookings").select("id, client_id, meeting_id").eq("meet_code", meetCode).maybeSingle();
  if (error) throw new Error(`bookings read failed: ${error.message}`);
  return data ? { id: data.id, clientId: data.client_id, meetingId: data.meeting_id } : null;
}

/** Ties a booking to its recording, so the bookings list can show what became of it. */
async function linkBooking(db: Db, booking: BookingRef | null, meetingId: string): Promise<void> {
  if (!booking || booking.meetingId === meetingId) return;
  const { error } = await db.from("client_meeting_bookings").update({ meeting_id: meetingId }).eq("id", booking.id);
  if (error) throw new Error(`bookings update failed: ${error.message}`);
}

/** Which of these tl;dv meeting ids are already stored. */
export async function knownMeetingIds(tldvMeetingIds: string[]): Promise<Set<string>> {
  if (!tldvMeetingIds.length) return new Set();
  const { data, error } = await supabaseAdmin().from("meetings").select("tldv_meeting_id").in("tldv_meeting_id", tldvMeetingIds);
  if (error) throw new Error(`meetings read failed: ${error.message}`);
  return new Set((data ?? []).map((m) => m.tldv_meeting_id));
}

export interface UpsertResult {
  meetingId: string;
  created: boolean;
  status: ProcessStatus;
  transcriptReady: boolean;
}

/**
 * Insert or refresh a meeting from tl;dv metadata. Metadata (title, time, duration, organiser, link,
 * raw payload) is always updated; type and status only when no person and no routine run owns them.
 * Participants are replaced from the invitee list (is_dny by domain, is_organizer by email).
 */
export async function upsertMeeting(meeting: TldvMeeting & { raw?: unknown }, source: MeetingSource): Promise<UpsertResult> {
  const db = supabaseAdmin();
  const existing = await loadState(db, { tldvMeetingId: meeting.id });
  const participants = participantRows(meeting);
  const [clients, booking] = await Promise.all([loadClients(db), loadBooking(db, meeting.meetCode ?? existing?.meet_code ?? null)]);
  const rules = applyRules({ durationSec: meeting.durationSec, sentenceCount: null, participants, clients, title: meeting.title, booking });
  const plan = planAfterUpsert(existing, rules);
  const metadata = metadataColumns(meeting);
  const raw = (meeting.raw ?? { ...meeting, raw: undefined }) as Json;

  let meetingId: string;
  let created = false;
  let status: ProcessStatus;
  if (!existing) {
    const { data, error } = await db
      .from("meetings")
      .insert({ ...metadata, ...plan.typeColumns, source, raw, process_status: plan.process_status ?? "new" })
      .select(STATE_COLUMNS)
      .single();
    if (error?.code === "23505") {
      // Lost a race with a parallel webhook or cron: the row exists now, refresh it instead.
      return upsertMeeting(meeting, source);
    }
    if (error || !data) throw new Error(`meetings insert failed: ${error?.message ?? "no row"}`);
    meetingId = data.id;
    status = data.process_status;
    created = true;
  } else {
    const { error } = await db
      .from("meetings")
      .update({ ...metadata, raw, ...(plan.typeColumns ?? {}), ...(plan.process_status ? { process_status: plan.process_status } : {}) })
      .eq("id", existing.id);
    if (error) throw new Error(`meetings update failed: ${error.message}`);
    meetingId = existing.id;
    status = plan.process_status ?? existing.process_status;
  }

  // Replace participants only when tl;dv gave us some: an empty list must not erase what we knew.
  if (participants.length > 0) {
    const { error: delError } = await db.from("participants").delete().eq("meeting_id", meetingId);
    if (delError) throw new Error(`participants delete failed: ${delError.message}`);
    const { error: insError } = await db.from("participants").insert(participants.map((p) => ({ ...p, meeting_id: meetingId })));
    if (insError) throw new Error(`participants insert failed: ${insError.message}`);
  }

  await linkBooking(db, booking, meetingId);

  if (created) {
    const what = status === "skipped" ? `skipped at intake (${rules.reason})` : booking ? "booked here as a client meeting" : rules.decided ? `rule says ${rules.type}` : "type to be decided";
    await logEvent("info", "intake", `Meeting seen via ${source}: ${what}`, meetingId);
  }
  return { meetingId, created, status, transcriptReady: existing?.transcript_ready ?? false };
}

export interface StoreTranscriptResult {
  status: ProcessStatus;
  type: string;
  sentenceCount: number;
  wordCount: number;
  speakerLabelsReliable: boolean | null;
}

/**
 * Store the transcript, mark the meeting transcript_ready, re-run the rules with the sentence count
 * and move the meeting to 'ready' (for the routine) or 'skipped' (decided non-client), unless a person
 * or a routine run owns the meeting's type and status.
 */
export async function storeTranscript(meetingId: string, turns: SpeakerTurn[], tldvTranscriptId: string | null, sentenceCount?: number): Promise<StoreTranscriptResult> {
  const db = supabaseAdmin();
  const state = await loadState(db, { id: meetingId });
  if (!state) throw new Error(`meeting ${meetingId} not found`);
  const [{ data: participants, error: pError }, clients, booking] = await Promise.all([
    db.from("participants").select("email, name").eq("meeting_id", meetingId),
    loadClients(db),
    loadBooking(db, state.meet_code),
  ]);
  if (pError) throw new Error(`participants read failed: ${pError.message}`);

  const sentences = sentenceCount ?? countSentences(turns);
  const words = wordCount(turns);
  const reliable = speakerLabelsReliable(
    turns.map((t) => t.speaker),
    (participants ?? []).map((p) => p.name),
  );
  const { error: tError } = await db.from("transcripts").upsert(
    {
      meeting_id: meetingId,
      tldv_transcript_id: tldvTranscriptId,
      turns: turns as unknown as Json,
      sentence_count: sentences,
      word_count: words,
      speaker_labels_reliable: reliable,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "meeting_id" },
  );
  if (tError) throw new Error(`transcripts upsert failed: ${tError.message}`);

  const rules = applyRules({ durationSec: state.duration_sec, sentenceCount: sentences, participants: participants ?? [], clients, title: state.title, booking });
  const plan = planAfterTranscript(state, rules);
  await linkBooking(db, booking, meetingId);
  const { data: updated, error: mError } = await db
    .from("meetings")
    .update({
      transcript_ready: true,
      ...(plan.typeColumns ?? {}),
      ...(plan.process_status ? { process_status: plan.process_status } : {}),
      // A late transcript re-opens a meeting that was skipped for having none.
      ...(plan.process_status === "ready" ? { failure_reason: null } : {}),
    })
    .eq("id", meetingId)
    .select("process_status, type")
    .single();
  if (mError || !updated) throw new Error(`meetings update failed: ${mError?.message ?? "no row"}`);

  const outcome =
    updated.process_status === "ready"
      ? "ready for the routine"
      : updated.process_status === "skipped"
        ? `skipped (${plan.typeColumns?.type_reason ?? "decided by a person"})`
        : `status left as ${updated.process_status}`;
  await logEvent("info", "transcript", `Transcript stored: ${sentences} sentences, ${words} words, speaker labels ${reliable === null ? "unknown" : reliable ? "reliable" : "unreliable"}; ${outcome}`, meetingId);
  return { status: updated.process_status, type: updated.type, sentenceCount: sentences, wordCount: words, speakerLabelsReliable: reliable };
}

/** tl;dv has not finished the transcript: 'new' becomes 'waiting_transcript'. Returns the status afterwards. */
export async function markWaiting(meetingId: string): Promise<ProcessStatus> {
  const db = supabaseAdmin();
  const state = await loadState(db, { id: meetingId });
  if (!state) throw new Error(`meeting ${meetingId} not found`);
  const next = statusAfterWaiting(state);
  if (!next) return state.process_status;
  const { error } = await db.from("meetings").update({ process_status: next }).eq("id", meetingId).eq("process_status", "new");
  if (error) throw new Error(`meetings update failed: ${error.message}`);
  return next;
}
