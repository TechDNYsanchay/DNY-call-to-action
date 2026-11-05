import "server-only";
import type { Json } from "@/lib/supabase/database.types";
import { supabaseServer } from "@/lib/supabase/server";
import { ilikePattern, type InboxQuery, PAGE_SIZE, pgQuote } from "@/lib/ui/query";
import { type ActionItemRow, type AgentRunSummary, type InboxRow, ITEM_COLUMNS, MEETING_COLUMNS, type MeetingSummary, PARTICIPANT_COLUMNS, type ParticipantSummary, type RowCounts, SHEET_COLUMNS, type SheetRow } from "./types";

// Reads for the inbox, the review queue and the meeting page, as the signed-in person (RLS).
// Explicit column lists everywhere; the one `result` jsonb read is the sheet on the detail page.

const fail = (where: string, error: { message: string } | null): void => {
  if (error) throw new Error(`${where}: ${error.message}`);
};

/** Open-item counts and latest headline for a set of meetings, in two small queries. */
async function decorate(meetings: MeetingSummary[]): Promise<InboxRow[]> {
  if (!meetings.length) return [];
  const db = await supabaseServer();
  const ids = meetings.map((m) => m.id);
  const [items, sheets] = await Promise.all([
    db.from("action_items").select("meeting_id, owed_by").in("meeting_id", ids).in("status", ["open", "in_progress"]),
    db.from("sheets").select("meeting_id, version, headline, decisions:result->decisions").in("meeting_id", ids).eq("status", "ready").order("version", { ascending: false }),
  ]);
  fail("action_items", items.error);
  fail("sheets", sheets.error);
  const counts = new Map<string, RowCounts>();
  const headlines = new Map<string, string>();
  for (const row of items.data ?? []) {
    const c = counts.get(row.meeting_id) ?? { dny: 0, client: 0, decisions: 0 };
    if (row.owed_by === "dny" || row.owed_by === "both") c.dny++;
    if (row.owed_by === "client" || row.owed_by === "both") c.client++;
    counts.set(row.meeting_id, c);
  }
  for (const row of sheets.data ?? []) {
    if (headlines.has(row.meeting_id)) continue; // ordered by version desc: first wins
    headlines.set(row.meeting_id, row.headline);
    const c = counts.get(row.meeting_id) ?? { dny: 0, client: 0, decisions: 0 };
    c.decisions = Array.isArray(row.decisions) ? row.decisions.length : 0;
    counts.set(row.meeting_id, c);
  }
  return meetings.map((m) => ({ ...m, headline: headlines.get(m.id) ?? null, counts: counts.get(m.id) ?? { dny: 0, client: 0, decisions: 0 } }));
}

/** Meeting ids whose client name or latest headline matches the search, for the inbox .or() filter. */
async function searchTargets(q: string): Promise<{ clientIds: string[]; meetingIds: string[] }> {
  const db = await supabaseServer();
  const pattern = ilikePattern(q);
  const [clients, sheets] = await Promise.all([
    db.from("clients").select("id").ilike("name", pattern).limit(50),
    db.from("sheets").select("meeting_id").ilike("headline", pattern).eq("status", "ready").limit(200),
  ]);
  fail("clients", clients.error);
  fail("sheets", sheets.error);
  return { clientIds: (clients.data ?? []).map((c) => c.id), meetingIds: [...new Set((sheets.data ?? []).map((s) => s.meeting_id))] };
}

export interface InboxPage {
  rows: InboxRow[];
  /** Rows pinned at the top regardless of date (needs a decision or failed), page 1 only. */
  pinned: InboxRow[];
  hasMore: boolean;
}

export async function listInbox(query: InboxQuery): Promise<InboxPage> {
  const db = await supabaseServer();
  const from = (query.page - 1) * PAGE_SIZE;
  let req = db.from("meetings").select(MEETING_COLUMNS).order("happened_at", { ascending: false }).range(from, from + PAGE_SIZE);
  if (!query.showSkipped) req = req.neq("process_status", "skipped");
  if (query.filter === "clients") req = req.eq("type", "client");
  if (query.filter === "attention") req = req.in("process_status", ["needs_decision", "failed"]);
  if (query.clientId) req = req.eq("client_id", query.clientId);
  if (query.q) {
    const { clientIds, meetingIds } = await searchTargets(query.q);
    const clauses = [`title.ilike.${pgQuote(ilikePattern(query.q))}`];
    if (clientIds.length) clauses.push(`client_id.in.(${clientIds.join(",")})`);
    if (meetingIds.length) clauses.push(`id.in.(${meetingIds.join(",")})`);
    req = req.or(clauses.join(","));
  }
  const pinnedReq =
    query.page === 1 && query.filter !== "attention" && !query.q
      ? (() => {
          let p = db.from("meetings").select(MEETING_COLUMNS).in("process_status", ["needs_decision", "failed"]).order("happened_at", { ascending: false }).limit(30);
          if (query.clientId) p = p.eq("client_id", query.clientId);
          if (query.filter === "clients") p = p.eq("type", "client");
          return p;
        })()
      : null;
  const [page, pinned] = await Promise.all([req, pinnedReq]);
  fail("meetings", page.error);
  if (pinned) fail("meetings", pinned.error);
  const pinnedRows = (pinned?.data ?? []) as MeetingSummary[];
  const pinnedIds = new Set(pinnedRows.map((m) => m.id));
  const pageRows = ((page.data ?? []) as MeetingSummary[]).filter((m) => !pinnedIds.has(m.id));
  const hasMore = pageRows.length > PAGE_SIZE;
  const decorated = await decorate([...pinnedRows, ...pageRows.slice(0, PAGE_SIZE)]);
  return { pinned: decorated.slice(0, pinnedRows.length), rows: decorated.slice(pinnedRows.length), hasMore };
}

/** How many meetings wait for a person, for the nav badge. */
export async function countNeedsDecision(): Promise<number> {
  const db = await supabaseServer();
  const { count, error } = await db.from("meetings").select("id", { count: "exact", head: true }).eq("process_status", "needs_decision");
  fail("meetings", error);
  return count ?? 0;
}

export interface ReviewMeeting extends MeetingSummary {
  participants: ParticipantSummary[];
}

/** The review queue: undecided meetings first, then recent sales meetings as quiet rows. */
export async function listReviewQueue(): Promise<{ undecided: ReviewMeeting[]; sales: ReviewMeeting[] }> {
  const db = await supabaseServer();
  const select = `${MEETING_COLUMNS}, participants(${PARTICIPANT_COLUMNS})` as const;
  const [undecided, sales] = await Promise.all([
    db.from("meetings").select(select).eq("process_status", "needs_decision").order("happened_at", { ascending: false }).limit(100),
    db.from("meetings").select(select).eq("type", "sales").eq("process_status", "skipped").order("happened_at", { ascending: false }).limit(30),
  ]);
  fail("meetings", undecided.error);
  fail("meetings", sales.error);
  return { undecided: (undecided.data ?? []) as ReviewMeeting[], sales: (sales.data ?? []) as ReviewMeeting[] };
}

export interface MeetingPageData {
  meeting: MeetingSummary;
  participants: ParticipantSummary[];
  /** The latest ready sheet, or null while processing. */
  sheet: SheetRow | null;
  versions: number;
  items: ActionItemRow[];
  runs: AgentRunSummary[];
}

export async function getMeetingPage(id: string): Promise<MeetingPageData | null> {
  const db = await supabaseServer();
  const { data: meeting, error } = await db.from("meetings").select(MEETING_COLUMNS).eq("id", id).maybeSingle();
  fail("meetings", error);
  if (!meeting) return null;
  const [participants, sheets, items, runs] = await Promise.all([
    db.from("participants").select(PARTICIPANT_COLUMNS).eq("meeting_id", id).order("is_organizer", { ascending: false }).order("email"),
    db.from("sheets").select(SHEET_COLUMNS).eq("meeting_id", id).order("version", { ascending: false }),
    db.from("action_items").select(ITEM_COLUMNS).eq("meeting_id", id).order("position"),
    db.from("agent_runs").select("id, kind, status, attempt, summary, errors, created_at").eq("meeting_id", id).order("created_at", { ascending: false }).limit(12),
  ]);
  fail("participants", participants.error);
  fail("sheets", sheets.error);
  fail("action_items", items.error);
  fail("agent_runs", runs.error);
  const all = sheets.data ?? [];
  return {
    meeting: meeting as MeetingSummary,
    participants: participants.data ?? [],
    sheet: all.find((s) => s.status === "ready") ?? all[0] ?? null,
    versions: all.length,
    items: items.data ?? [],
    runs: runs.data ?? [],
  };
}

/** Title and status only, for the transcript page header and the not-found check. */
export async function getMeetingHeader(id: string): Promise<MeetingSummary | null> {
  const db = await supabaseServer();
  const { data, error } = await db.from("meetings").select(MEETING_COLUMNS).eq("id", id).maybeSingle();
  fail("meetings", error);
  return (data as MeetingSummary | null) ?? null;
}

export async function getTranscriptTurns(meetingId: string): Promise<{ turns: Json; speaker_labels_reliable: boolean | null; fetched_at: string } | null> {
  const db = await supabaseServer();
  const { data, error } = await db.from("transcripts").select("turns, speaker_labels_reliable, fetched_at").eq("meeting_id", meetingId).maybeSingle();
  fail("transcripts", error);
  return data;
}
