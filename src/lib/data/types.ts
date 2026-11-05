// Row shapes the screens render. Each is a Pick of the generated Row type so the explicit column
// lists in the queries and the components cannot drift apart without the type checker noticing.

import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];

export type MeetingRow = Tables["meetings"]["Row"];
export type ClientRow = Tables["clients"]["Row"];
export type PersonRow = Tables["people"]["Row"];
export type ParticipantRow = Tables["participants"]["Row"];
export type AgentRunRow = Tables["agent_runs"]["Row"];

export type ClientRef = Pick<ClientRow, "id" | "name">;

/** What every meeting list and header needs; never the raw jsonb. */
export type MeetingSummary = Pick<
  MeetingRow,
  | "id"
  | "tldv_meeting_id"
  | "title"
  | "happened_at"
  | "duration_sec"
  | "organizer_email"
  | "organizer_name"
  | "tldv_url"
  | "type"
  | "type_source"
  | "type_confidence"
  | "type_reason"
  | "client_id"
  | "client_name_guess"
  | "transcript_ready"
  | "process_status"
  | "process_attempts"
  | "claimed_at"
  | "failure_reason"
  | "source"
  | "created_at"
  | "updated_at"
> & { client: ClientRef | null };

export const MEETING_COLUMNS =
  "id, tldv_meeting_id, title, happened_at, duration_sec, organizer_email, organizer_name, tldv_url, type, type_source, type_confidence, type_reason, client_id, client_name_guess, transcript_ready, process_status, process_attempts, claimed_at, failure_reason, source, created_at, updated_at, client:clients(id, name)" as const;

export type ActionItemRow = Pick<
  Tables["action_items"]["Row"],
  | "id"
  | "meeting_id"
  | "sheet_id"
  | "item_key"
  | "position"
  | "title"
  | "details"
  | "owed_by"
  | "owner_name"
  | "owner_email"
  | "owner_basis"
  | "due_date"
  | "due_kind"
  | "due_phrase"
  | "priority"
  | "status"
  | "evidence_ts_sec"
  | "evidence_speaker"
  | "evidence_quote"
  | "evidence_verified"
  | "confidence"
  | "linked_decision"
  | "edited_by"
  | "edited_at"
  | "done_at"
  | "done_by"
  | "erp_task_id"
  | "erp_sync_status"
>;

export const ITEM_COLUMNS =
  "id, meeting_id, sheet_id, item_key, position, title, details, owed_by, owner_name, owner_email, owner_basis, due_date, due_kind, due_phrase, priority, status, evidence_ts_sec, evidence_speaker, evidence_quote, evidence_verified, confidence, linked_decision, edited_by, edited_at, done_at, done_by, erp_task_id, erp_sync_status" as const;

export type ParticipantSummary = Pick<ParticipantRow, "email" | "name" | "domain" | "is_dny" | "is_organizer">;
export const PARTICIPANT_COLUMNS = "email, name, domain, is_dny, is_organizer" as const;

export type PersonSummary = Pick<PersonRow, "id" | "full_name" | "email" | "role" | "dept" | "active">;
export const PERSON_COLUMNS = "id, full_name, email, role, dept, active" as const;

/** The counts an inbox row shows: open items per side and decisions in the latest sheet. */
export interface RowCounts {
  dny: number;
  client: number;
  decisions: number;
}

export interface InboxRow extends MeetingSummary {
  headline: string | null;
  counts: RowCounts;
}

export type SheetRow = Pick<Tables["sheets"]["Row"], "id" | "version" | "status" | "headline" | "result" | "model" | "prompt_version" | "created_at">;
export const SHEET_COLUMNS = "id, version, status, headline, result, model, prompt_version, created_at" as const;

export type AgentRunSummary = Pick<AgentRunRow, "id" | "kind" | "status" | "attempt" | "summary" | "errors" | "created_at">;
