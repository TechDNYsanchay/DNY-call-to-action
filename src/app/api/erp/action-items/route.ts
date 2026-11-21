// Sync collects what came out of the meetings it booked: for each booking, the recording's state
// and, once its sheet is ready, the action items DNY owes. Sync asks every few minutes for its recent
// bookings; an item keeps its id across re-runs, which is how Sync recognises one it already has.

import { evidenceLine, goesToErp, parseBookingIds, type ErpActionItem } from "@/lib/erp/contract";
import { erpGuard, erpJson } from "@/lib/erp/guard";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const refused = erpGuard(request);
  if (refused) return refused;
  const ids = parseBookingIds(new URL(request.url).searchParams.get("booking_ids"));
  if (!ids.ok) return erpJson({ error: ids.error }, 400);
  if (!ids.ids.length) return erpJson({ bookings: [] });

  const db = supabaseAdmin();
  const { data: bookings, error } = await db.from("client_meeting_bookings").select("id, status, meeting_id").in("id", ids.ids);
  if (error) return erpJson({ error: `Couldn't read the bookings: ${error.message}` }, 500);

  const meetingIds = (bookings ?? []).map((b) => b.meeting_id).filter((m): m is string => Boolean(m));
  const meetings = new Map<string, { title: string | null; happened_at: string; tldv_url: string | null; process_status: string }>();
  const ready = new Set<string>();
  const items = new Map<string, ErpActionItem[]>();

  if (meetingIds.length) {
    const [m, s, a] = await Promise.all([
      db.from("meetings").select("id, title, happened_at, tldv_url, process_status").in("id", meetingIds),
      db.from("sheets").select("meeting_id").in("meeting_id", meetingIds).eq("status", "ready"),
      db
        .from("action_items")
        .select("id, meeting_id, title, details, owed_by, owner_email, owner_name, due_date, priority, status, evidence_ts_sec, evidence_speaker, evidence_quote, position")
        .in("meeting_id", meetingIds)
        .order("position"),
    ]);
    if (m.error || s.error || a.error) return erpJson({ error: `Couldn't read the meetings: ${(m.error ?? s.error ?? a.error)!.message}` }, 500);
    for (const row of m.data ?? []) meetings.set(row.id, row);
    for (const row of s.data ?? []) ready.add(row.meeting_id);
    for (const row of a.data ?? []) {
      if (!ready.has(row.meeting_id) || !goesToErp(row)) continue;
      const list = items.get(row.meeting_id) ?? [];
      list.push({
        id: row.id,
        title: row.title,
        details: row.details,
        owed_by: row.owed_by as "dny" | "both",
        owner_email: row.owner_email,
        owner_name: row.owner_name,
        due_date: row.due_date,
        priority: row.priority,
        status: row.status as ErpActionItem["status"],
        evidence: evidenceLine(row),
      });
      items.set(row.meeting_id, list);
    }
  }

  return erpJson({
    bookings: (bookings ?? []).map((b) => {
      const meeting = b.meeting_id ? meetings.get(b.meeting_id) : undefined;
      return {
        id: b.id,
        status: b.status,
        meeting: meeting ? { title: meeting.title, happened_at: meeting.happened_at, recording_url: meeting.tldv_url, process_status: meeting.process_status } : null,
        sheet_ready: Boolean(b.meeting_id && ready.has(b.meeting_id)),
        items: b.meeting_id ? (items.get(b.meeting_id) ?? []) : [],
      };
    }),
  });
}
