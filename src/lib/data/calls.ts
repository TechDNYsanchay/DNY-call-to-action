import "server-only";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth/require-user";
import { type CallyzerState, parseCallyzerState } from "@/lib/calls/deps";
import { type CallFeedStatus, parseFeedStatus } from "@/lib/calls/feed";
import { istDayStartIso } from "@/lib/calls/schedule";
import { type CallsSettings, DEFAULT_CALLS_SETTINGS, parseCallsSettings } from "@/lib/calls/settings";
import { istDate } from "@/lib/format";
import { parseSettings } from "@/lib/ingest/settings";
import { parseTurns } from "@/lib/sheet/load";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { CALLS_PAGE_SIZE, type CallsQuery, type CallsSearch, callsSearchOf, pageAfterPinned } from "@/lib/ui/calls-query";
import { isBusinessType } from "@/lib/ui/audio-access";
import { type LatencyRow, latencyRows } from "@/lib/ui/latency";
import { lineDisplayName } from "@/lib/ui/line-name";
import { ilikePattern, pgQuote } from "@/lib/ui/query";
import type { CallsNav } from "@/components/shell/nav-items";
import { listClientOptions } from "./clients";
import { decorate } from "./meetings";
import { listActivePeople } from "./people";
import {
  type ActionItemRow,
  type AgentRunSummary,
  CALL_COLUMNS,
  type ClientRef,
  type InboxRow,
  ITEM_COLUMNS,
  MEETING_COLUMNS,
  type MeetingSummary,
  type PersonSummary,
  type PhoneCallRow,
  SHEET_COLUMNS,
  type SheetRow,
} from "./types";

// Reads for the Calls screens. Lists, the call page and the nav go through row-level security as the
// signed-in person, like meetings. Four reads use the secret key, each after the person is checked: the
// calls settings (members cannot read the settings table, yet the hints need its times), an undecided call's
// turns (secret-only until the call is confirmed as business), the full number behind "Call back", and a
// number search, which returns call ids only. Explicit column lists everywhere.

const fail = (where: string, error: { message: string } | null): void => {
  if (error) throw new Error(`${where}: ${error.message}`);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The phone_calls columns a list row needs. */
const CALL_LIST_COLUMNS = "direction, counterpart_masked, counterpart_name, recording_status, stt_status, stt_error_kind, stt_next_try_at, stored_at, ready_at, decision_reason, decision_since, skip_code, purged_at, line_id" as const;

export type CallListFacts = Pick<
  PhoneCallRow,
  "direction" | "counterpart_masked" | "counterpart_name" | "recording_status" | "stt_status" | "stt_error_kind" | "stt_next_try_at" | "stored_at" | "ready_at" | "decision_reason" | "decision_since" | "skip_code" | "purged_at" | "line_id"
>;

export interface CallRow extends InboxRow {
  call: CallListFacts;
}

export interface LineMember {
  id: string;
  full_name: string;
}

/** A DNY phone line as every person sees it: never its number. */
export interface LineSummary {
  id: string;
  label: string | null;
  callyzer_name: string;
  enabled: boolean;
  members: LineMember[];
  /** lineDisplayName: the label, the sole person's phone, or Callyzer's name. */
  name: string;
}

type LineEmbed = {
  id: string;
  label: string | null;
  callyzer_name: string;
  enabled: boolean;
  members: Array<{ person: { id: string; full_name: string; active: boolean } | null }> | null;
};

const LINE_SELECT = "id, label, callyzer_name, enabled, members:phone_line_members(person:people(id, full_name, active))" as const;

function toLineSummary(line: LineEmbed): LineSummary {
  const members = (line.members ?? []).flatMap((m) => (m.person?.active ? [{ id: m.person.id, full_name: m.person.full_name }] : []));
  return { id: line.id, label: line.label, callyzer_name: line.callyzer_name, enabled: line.enabled, members, name: lineDisplayName(line, members) };
}

// ------------------------------------------------------------------------------------------ Settings

/**
 * The calls settings (and pipeline_paused), with the secret key: every hint on a call ("deleted at 11:00
 * unless someone decides") needs an admin-only setting. Values only, no secrets; defaults when unreadable.
 */
export async function readCallsSettings(): Promise<CallsSettings> {
  const { data, error } = await supabaseAdmin().from("settings").select("key, value");
  if (error) {
    console.warn(`settings: ${error.message}`);
    return DEFAULT_CALLS_SETTINGS;
  }
  return parseCallsSettings(data ?? []);
}

// -------------------------------------------------------------------------------------- Feed and nav

/** calls_feed_status() as the signed-in person: switches, the last poll, error kinds and today's breakdown. */
export async function getCallFeedStatus(): Promise<CallFeedStatus | null> {
  const db = await supabaseServer();
  const { data, error } = await db.rpc("calls_feed_status");
  if (error) {
    console.warn(`calls_feed_status: ${error.message}`);
    return null;
  }
  return parseFeedStatus(data);
}

const NAV_HIDDEN: CallsNav = { visible: false, decisions: 0 };

/** Whether Calls shows in the nav and its badge (calls_nav()); hidden on any error, so the shell never fails. */
export async function callsNav(): Promise<CallsNav> {
  try {
    const db = await supabaseServer();
    const { data, error } = await db.rpc("calls_nav");
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return NAV_HIDDEN;
    const o = data as Record<string, unknown>;
    const decisions = Number(o.decisions);
    return { visible: o.visible === true, decisions: Number.isFinite(decisions) && decisions > 0 ? Math.floor(decisions) : 0 };
  } catch {
    return NAV_HIDDEN;
  }
}

// --------------------------------------------------------------------------------------------- List

/**
 * Ids go into the list request's URL (`.in()`, `.or()`), and the API gateway refuses a request line past 8 KB
 * (414). 100 ids keep it near 4.7 KB, whatever the filters add.
 */
const MAX_LIST_IDS = 100;

/**
 * Client and vendor calls (not deleted) whose other party's number contains these digits (7 or more), newest
 * first, as ids only. The number lives in the secret-only ledger; call_ids_by_digits matches it in the database
 * and takes the digits in the request body, so the number never sits in a URL (a filter would put it in the
 * gateway's request log) and never leaves the database.
 */
export async function searchCallIdsByDigits(digits: string): Promise<string[]> {
  await requireUser();
  if (!/^\d{7,15}$/.test(digits)) return [];
  const { data, error } = await supabaseAdmin().rpc("call_ids_by_digits", { p_digits: digits, p_limit: MAX_LIST_IDS });
  fail("call_ids_by_digits", error);
  return [...new Set((data ?? []).map((r) => r.meeting_id))];
}

/**
 * Call ids whose headline, or client ids whose name, matches a text search: the newest headline matches and the
 * first clients by name, together at most MAX_LIST_IDS. Titles match in the list query itself, without a limit.
 */
async function callSearchTargets(q: string): Promise<{ clientIds: string[]; meetingIds: string[] }> {
  const db = await supabaseServer();
  const pattern = ilikePattern(q);
  const [clients, sheets] = await Promise.all([
    db.from("clients").select("id").ilike("name", pattern).order("name").limit(25),
    db
      .from("sheets")
      .select("meeting_id, meeting:meetings!inner(kind)")
      .ilike("headline", pattern)
      .eq("status", "ready")
      .eq("meeting.kind", "call")
      .order("created_at", { ascending: false })
      .limit(MAX_LIST_IDS - 25),
  ]);
  fail("clients", clients.error);
  fail("sheets", sheets.error);
  return { clientIds: (clients.data ?? []).map((c) => c.id), meetingIds: [...new Set((sheets.data ?? []).map((s) => s.meeting_id))] };
}

export interface CallsPage {
  rows: CallRow[];
  /** Page 1 only: calls that need a person or are still moving, whatever their date. */
  pinned: CallRow[];
  hasMore: boolean;
  /** Every registered line, for the filter and the rows' line names. */
  lines: LineSummary[];
  search: CallsSearch;
}

const PINNED_STATUSES = ["needs_decision", "failed", "waiting_transcript", "ready", "processing"] as const;
const LIST_SELECT = `${MEETING_COLUMNS}, call:phone_calls!inner(${CALL_LIST_COLUMNS})` as const;

/**
 * The Calls list in two rounds: the page, the pinned rows, the lines (and a search's targets) at once; then
 * counts and headlines. A number search comes as `digits` (from a server action, never from the URL: the page
 * keeps numbers out of its address); `query.q` is a text search.
 */
export async function listCalls(query: CallsQuery, opts: { digits?: string | null } = {}): Promise<CallsPage> {
  const db = await supabaseServer();
  const text = callsSearchOf(query.q);
  const search: CallsSearch = opts.digits ? { kind: "digits", digits: opts.digits } : text?.kind === "text" ? text : null;
  const from = (query.page - 1) * CALLS_PAGE_SIZE;

  const linesReq = db.from("phone_lines").select(LINE_SELECT).order("callyzer_name");
  const digitsReq = search?.kind === "digits" ? searchCallIdsByDigits(search.digits) : null;
  const textReq = search?.kind === "text" ? callSearchTargets(search.text) : null;
  const pinnedReq =
    query.page === 1 && !search && query.filter !== "decide"
      ? (() => {
          let p = db.from("meetings").select(LIST_SELECT).eq("kind", "call").in("process_status", [...PINNED_STATUSES]).order("happened_at", { ascending: false }).limit(30);
          if (query.filter === "client" || query.filter === "vendor") p = p.eq("type", query.filter);
          if (query.lineId) p = p.eq("call.line_id", query.lineId);
          if (query.clientId) p = p.eq("client_id", query.clientId);
          return p;
        })()
      : null;

  const pageReq = async () => {
    const ids = digitsReq ? await digitsReq : null;
    // A number that matches no business call needs no further read.
    if (ids && !ids.length) return { data: [], error: null };
    const targets = textReq ? await textReq : null;
    let req = db.from("meetings").select(LIST_SELECT).eq("kind", "call").order("happened_at", { ascending: false }).range(from, from + CALLS_PAGE_SIZE);
    if (!query.showNotWork) req = req.neq("process_status", "skipped");
    if (query.filter === "client" || query.filter === "vendor") req = req.eq("type", query.filter);
    if (query.filter === "decide") req = req.in("process_status", ["needs_decision", "failed"]);
    if (query.lineId) req = req.eq("call.line_id", query.lineId);
    if (query.clientId) req = req.eq("client_id", query.clientId);
    if (ids) req = req.in("id", ids).in("type", ["client", "vendor"]).is("call.purged_at", null);
    if (search?.kind === "text" && targets) {
      const clauses = [`title.ilike.${pgQuote(ilikePattern(search.text))}`];
      if (targets.clientIds.length) clauses.push(`client_id.in.(${targets.clientIds.join(",")})`);
      if (targets.meetingIds.length) clauses.push(`id.in.(${targets.meetingIds.join(",")})`);
      req = req.or(clauses.join(","));
    }
    return req;
  };

  const [lines, page, pinned] = await Promise.all([linesReq, pageReq(), pinnedReq]);
  fail("phone_lines", lines.error);
  fail("meetings", page.error);
  if (pinned) fail("meetings", pinned.error);

  const pinnedRows = (pinned?.data ?? []) as unknown as Array<MeetingSummary & { call: CallListFacts }>;
  const pinnedIds = new Set(pinnedRows.map((m) => m.id));
  const { rows: pageRows, hasMore } = pageAfterPinned((page.data ?? []) as unknown as Array<MeetingSummary & { call: CallListFacts }>, pinnedIds);
  const decorated = await decorate([...pinnedRows, ...pageRows]);
  return {
    pinned: decorated.slice(0, pinnedRows.length),
    rows: decorated.slice(pinnedRows.length),
    hasMore,
    lines: ((lines.data ?? []) as unknown as LineEmbed[]).map(toLineSummary),
    search,
  };
}

// --------------------------------------------------------------------------------------- Call page

export interface CallLine extends LineSummary {
  members: Array<LineMember & { email: string; dept: string | null }>;
}

export interface CallPageData {
  meeting: MeetingSummary;
  call: PhoneCallRow;
  line: CallLine | null;
  /** The latest ready sheet, or null before the first one. */
  sheet: SheetRow | null;
  versions: number;
  items: ActionItemRow[];
  /** The routine's notes on this call; admins only. */
  runs: AgentRunSummary[];
  /** The turns, or null when this person may not read them (an undecided call that is not theirs). */
  turns: SpeakerTurn[] | null;
  /** The other party's full number for "Call back": business, not deleted, admins and the line's people. */
  callBack: string | null;
  isLineMember: boolean;
  /** A client or vendor call: open to every active person, like a meeting. */
  isBusiness: boolean;
  /** Admins and the line's people see an undecided call's recording and transcript. */
  canSeeUndecided: boolean;
  settings: CallsSettings;
  clients: ClientRef[];
  people: PersonSummary[];
}

type CallPageLineEmbed = Omit<LineEmbed, "members"> & {
  members: Array<{ person: { id: string; full_name: string; email: string; dept: string | null; active: boolean } | null }> | null;
};
type CallPageMeeting = MeetingSummary & { call: (PhoneCallRow & { line: CallPageLineEmbed | null }) | null };

const PAGE_SELECT =
  `${MEETING_COLUMNS}, call:phone_calls(${CALL_COLUMNS}, line:phone_lines(id, label, callyzer_name, enabled, members:phone_line_members(person:people(id, full_name, email, dept, active))))` as const;

/**
 * One call in two rounds. Round 1: the call with its line and people (RLS), plus the settings, clients
 * and team that do not depend on it. Round 2: the sheet, items, the routine's notes (admins), the turns and
 * the call-back number. A meeting's id redirects to the meeting page.
 */
export async function getCallPage(id: string, viewer: { personId: string; isAdmin: boolean }): Promise<CallPageData | null> {
  if (!UUID.test(id)) return null;
  const db = await supabaseServer();
  const [row, settings, clients, people] = await Promise.all([db.from("meetings").select(PAGE_SELECT).eq("id", id).maybeSingle(), readCallsSettings(), listClientOptions(), listActivePeople()]);
  fail("meetings", row.error);
  const found = row.data as unknown as CallPageMeeting | null;
  if (!found) return null;
  if (found.kind !== "call") redirect(`/meetings/${id}`);
  const { call: rawCall, ...meeting } = found;
  if (!rawCall) return null;
  const { line: rawLine, ...call } = rawCall;

  const line: CallLine | null = rawLine
    ? (() => {
        const members = (rawLine.members ?? []).flatMap((m) => (m.person?.active ? [{ id: m.person.id, full_name: m.person.full_name, email: m.person.email, dept: m.person.dept }] : []));
        return { id: rawLine.id, label: rawLine.label, callyzer_name: rawLine.callyzer_name, enabled: rawLine.enabled, members, name: lineDisplayName(rawLine, members) };
      })()
    : null;
  const isLineMember = Boolean(line?.members.some((m) => m.id === viewer.personId));
  const isBusiness = isBusinessType(meeting.type);
  const canSeeUndecided = viewer.isAdmin || isLineMember;
  const purged = Boolean(call.purged_at);

  const admin = supabaseAdmin();
  const turnsReq = purged
    ? null
    : isBusiness
      ? db.from("transcripts").select("turns").eq("meeting_id", id).maybeSingle()
      : canSeeUndecided
        ? admin.from("call_transcripts").select("turns").eq("meeting_id", id).maybeSingle()
        : null;
  const callBackReq = isBusiness && !purged && canSeeUndecided ? admin.from("call_log").select("counterpart_e164").eq("meeting_id", id).maybeSingle() : null;

  const [sheets, versions, items, runs, turns, callBack] = await Promise.all([
    db.from("sheets").select(SHEET_COLUMNS).eq("meeting_id", id).eq("status", "ready").order("version", { ascending: false }).limit(1),
    db.from("sheets").select("id", { count: "exact", head: true }).eq("meeting_id", id),
    db.from("action_items").select(ITEM_COLUMNS).eq("meeting_id", id).order("position"),
    viewer.isAdmin ? db.from("agent_runs").select("id, kind, status, attempt, summary, errors, created_at").eq("meeting_id", id).order("created_at", { ascending: false }).limit(12) : null,
    turnsReq,
    callBackReq,
  ]);
  fail("sheets", sheets.error);
  fail("sheets", versions.error);
  fail("action_items", items.error);
  if (runs) fail("agent_runs", runs.error);
  if (turns) fail("transcripts", turns.error);
  if (callBack) fail("call_log", callBack.error);

  return {
    meeting: meeting as MeetingSummary,
    call: call as PhoneCallRow,
    line,
    sheet: sheets.data?.[0] ?? null,
    versions: versions.count ?? 0,
    items: items.data ?? [],
    runs: runs?.data ?? [],
    turns: purged ? [] : turnsReq ? parseTurns(turns?.data?.turns ?? null) : null,
    callBack: callBack?.data?.counterpart_e164 ?? null,
    isLineMember,
    isBusiness,
    canSeeUndecided,
    settings,
    clients,
    people,
  };
}

/** Enough for the browser tab: who and when, as the signed-in person. */
export async function getCallHeader(id: string): Promise<(MeetingSummary & { call: Pick<PhoneCallRow, "counterpart_name" | "counterpart_masked"> | null }) | null> {
  if (!UUID.test(id)) return null;
  const db = await supabaseServer();
  const { data, error } = await db.from("meetings").select(`${MEETING_COLUMNS}, call:phone_calls(counterpart_name, counterpart_masked)`).eq("id", id).maybeSingle();
  fail("meetings", error);
  return (data as unknown as (MeetingSummary & { call: Pick<PhoneCallRow, "counterpart_name" | "counterpart_masked"> | null }) | null) ?? null;
}

// ----------------------------------------------------------------------------- Settings > Phone calls

export interface AdminLine extends LineSummary {
  /** The line's full number: admins only, from the secret-key read. */
  phone: string;
  enabledAt: string | null;
  analyseFrom: string | null;
  lastCallAt: string | null;
  firstSeenAt: string;
  /** Today's (IST) calls on the line: the last poll's counts, and how many became a call in the app. */
  today: { calls: number; candidates: number; withLink: number; analysed: number };
}

export interface RecentNotWork {
  id: string;
  masked: string;
  lineName: string;
  code: string | null;
  by: string | null;
  purgedAt: string;
  happenedAt: string;
}

export interface PhoneCallsAdmin {
  settings: CallsSettings;
  /** The routine's items per run (meetings and calls). */
  maxPerRun: number;
  state: CallyzerState;
  feed: CallFeedStatus | null;
  lines: AdminLine[];
  people: PersonSummary[];
  /** Ledger rows whose copy failed, today or yesterday (IST): what "Retry" puts back in the queue. */
  copiesFailed: number;
  recentNotWork: RecentNotWork[];
  latency: LatencyRow[];
  /** Business calls with a sheet in the last 7 days. */
  latencyCalls: number;
  rereads: Array<{ day: string; done_at: string | null }>;
}

/** Settings > Phone calls: everything the card shows, with the secret key after the admin check. */
export async function getPhoneCallsAdmin(): Promise<PhoneCallsAdmin> {
  await requireAdmin();
  const admin = supabaseAdmin();
  const now = new Date();
  const todayStart = istDayStartIso(now);
  const yesterdayStart = new Date(Date.parse(todayStart) - 86_400_000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [settings, sync, lines, people, failedCopies, ledgerToday, stubs, latency, rereads, feed] = await Promise.all([
    admin.from("settings").select("key, value"),
    admin.from("sync_state").select("value").eq("key", "callyzer").maybeSingle(),
    admin.from("phone_lines").select("id, phone, label, callyzer_name, enabled, enabled_at, analyse_from, first_seen_at, last_call_at, members:phone_line_members(person:people(id, full_name, active))").order("callyzer_name"),
    listActivePeople(),
    admin.from("call_log").select("callyzer_id", { count: "exact", head: true }).eq("status", "failed").gte("call_started_at", yesterdayStart),
    admin.from("call_log").select("line_id, status").gte("call_started_at", todayStart).limit(2000),
    admin.from("phone_calls").select("meeting_id, counterpart_masked, line_id, skip_code, purged_by, purged_at, meeting:meetings!inner(happened_at)").not("purged_at", "is", null).order("purged_at", { ascending: false }).limit(10),
    admin.from("phone_calls").select("call_ended_at, recording_seen_at, stored_at, transcribed_at, ready_at, first_claimed_at, first_sheet_at").gte("first_sheet_at", weekAgo).limit(500),
    admin.from("call_reread_requests").select("day, done_at").order("day", { ascending: false }).limit(14),
    getCallFeedStatus(),
  ]);
  fail("settings", settings.error);
  fail("phone_lines", lines.error);
  fail("call_log", failedCopies.error);
  fail("call_log", ledgerToday.error);
  fail("phone_calls", stubs.error);
  fail("phone_calls", latency.error);
  fail("call_reread_requests", rereads.error);

  const state = parseCallyzerState(sync.data?.value ?? null);
  // The poll overwrites today's counts every run; yesterday's are not today's.
  const pollLines = state.today?.day === istDate(now) ? (state.today.lines ?? state.lines ?? {}) : {};
  const analysed = new Map<string, number>();
  for (const row of ledgerToday.data ?? []) if (row.status === "promoted") analysed.set(row.line_id, (analysed.get(row.line_id) ?? 0) + 1);

  type AdminLineRow = LineEmbed & { phone: string; enabled_at: string | null; analyse_from: string | null; first_seen_at: string; last_call_at: string | null };
  const adminLines = ((lines.data ?? []) as unknown as AdminLineRow[]).map((l): AdminLine => {
    const counts = pollLines[l.id] ?? { calls: 0, candidates: 0, withLink: 0 };
    return {
      ...toLineSummary(l),
      phone: l.phone,
      enabledAt: l.enabled_at,
      analyseFrom: l.analyse_from,
      lastCallAt: l.last_call_at,
      firstSeenAt: l.first_seen_at,
      today: { calls: counts.calls ?? 0, candidates: counts.candidates ?? 0, withLink: counts.withLink ?? 0, analysed: analysed.get(l.id) ?? 0 },
    };
  });
  const lineNames = new Map(adminLines.map((l) => [l.id, l.name]));

  return {
    settings: parseCallsSettings(settings.data ?? []),
    maxPerRun: parseSettings(settings.data ?? []).max_per_run,
    state,
    feed,
    lines: adminLines,
    people,
    copiesFailed: failedCopies.count ?? 0,
    recentNotWork: (stubs.data ?? []).map((s) => ({
      id: s.meeting_id,
      masked: s.counterpart_masked,
      lineName: lineNames.get(s.line_id) ?? "A removed line",
      code: s.skip_code,
      by: s.purged_by,
      purgedAt: s.purged_at ?? "",
      happenedAt: s.meeting?.happened_at ?? "",
    })),
    latency: latencyRows(latency.data ?? []),
    latencyCalls: latency.data?.length ?? 0,
    rereads: rereads.data ?? [],
  };
}
