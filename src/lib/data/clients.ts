import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { type ActionItemRow, type ClientRef, type ClientRow, ITEM_COLUMNS, MEETING_COLUMNS, type MeetingSummary } from "./types";

// Client reads: the list with its counts, one client's page, and the short options list the
// dialogs use.

export type ClientSummary = Pick<ClientRow, "id" | "name" | "status" | "domains" | "contact_emails" | "erp_client_id" | "notes" | "created_at" | "updated_at">;
const CLIENT_COLUMNS = "id, name, status, domains, contact_emails, erp_client_id, notes, created_at, updated_at" as const;

export interface ClientListRow extends ClientSummary {
  openDny: number;
  lastMeetingAt: string | null;
  meetings: number;
}

const fail = (where: string, error: { message: string } | null): void => {
  if (error) throw new Error(`${where}: ${error.message}`);
};

export async function listClients(): Promise<ClientListRow[]> {
  const db = await supabaseServer();
  const [clients, items, meetings] = await Promise.all([
    db.from("clients").select(CLIENT_COLUMNS).order("name"),
    db.from("action_items").select("owed_by, meeting:meetings!inner(client_id)").in("status", ["open", "in_progress"]).in("owed_by", ["dny", "both"]).limit(2000),
    db.from("meetings").select("client_id, happened_at").not("client_id", "is", null).order("happened_at", { ascending: false }).limit(2000),
  ]);
  fail("clients", clients.error);
  fail("action_items", items.error);
  fail("meetings", meetings.error);
  const openDny = new Map<string, number>();
  for (const row of items.data ?? []) {
    const clientId = row.meeting?.client_id;
    if (clientId) openDny.set(clientId, (openDny.get(clientId) ?? 0) + 1);
  }
  const last = new Map<string, string>();
  const count = new Map<string, number>();
  for (const m of meetings.data ?? []) {
    if (!m.client_id) continue;
    if (!last.has(m.client_id)) last.set(m.client_id, m.happened_at);
    count.set(m.client_id, (count.get(m.client_id) ?? 0) + 1);
  }
  return (clients.data ?? []).map((c) => ({ ...c, openDny: openDny.get(c.id) ?? 0, lastMeetingAt: last.get(c.id) ?? null, meetings: count.get(c.id) ?? 0 }));
}

export interface ClientMeeting extends MeetingSummary {
  headline: string | null;
}

export interface ClientPageData {
  client: ClientSummary;
  meetings: ClientMeeting[];
  /** Open items across this client's meetings, with the meeting they came from. */
  items: Array<ActionItemRow & { meeting_title: string | null; meeting_happened_at: string }>;
}

export async function getClientPage(id: string): Promise<ClientPageData | null> {
  const db = await supabaseServer();
  const { data: client, error } = await db.from("clients").select(CLIENT_COLUMNS).eq("id", id).maybeSingle();
  fail("clients", error);
  if (!client) return null;
  const { data: meetingRows, error: mError } = await db.from("meetings").select(MEETING_COLUMNS).eq("client_id", id).order("happened_at", { ascending: false }).limit(100);
  fail("meetings", mError);
  const meetings = (meetingRows ?? []) as MeetingSummary[];
  const ids = meetings.map((m) => m.id);
  if (!ids.length) return { client, meetings: [], items: [] };
  const [sheets, items] = await Promise.all([
    db.from("sheets").select("meeting_id, version, headline").in("meeting_id", ids).eq("status", "ready").order("version", { ascending: false }),
    db.from("action_items").select(ITEM_COLUMNS).in("meeting_id", ids).in("status", ["open", "in_progress"]).order("due_date", { ascending: true, nullsFirst: false }).limit(500),
  ]);
  fail("sheets", sheets.error);
  fail("action_items", items.error);
  const headlines = new Map<string, string>();
  for (const s of sheets.data ?? []) if (!headlines.has(s.meeting_id)) headlines.set(s.meeting_id, s.headline);
  const byId = new Map(meetings.map((m) => [m.id, m]));
  return {
    client,
    meetings: meetings.map((m) => ({ ...m, headline: headlines.get(m.id) ?? null })),
    items: (items.data ?? []).map((i) => ({ ...i, meeting_title: byId.get(i.meeting_id)?.title ?? null, meeting_happened_at: byId.get(i.meeting_id)?.happened_at ?? "" })),
  };
}

/** id + name of every client, for selects and the decision dialog. */
export async function listClientOptions(): Promise<ClientRef[]> {
  const db = await supabaseServer();
  const { data, error } = await db.from("clients").select("id, name").order("name");
  fail("clients", error);
  return data ?? [];
}
