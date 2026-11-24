// Sync collects what came out of the conversations it did not book: phone calls on DNY's client-work
// lines, and recordings nobody booked from Sync. For each client or vendor conversation since `since`
// whose sheet is ready, the DNY-owed action items, with the line it came in on so Sync can tell who
// approves them. The counterpart's number is never sent.

import { evidenceLine, goesToErp, MAX_CALLS_PER_READ, parseSince, type ErpActionItem, type ErpCall } from "@/lib/erp/contract";
import { erpGuard, erpJson } from "@/lib/erp/guard";
import { siteUrl } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const refused = erpGuard(request);
  if (refused) return refused;
  const since = parseSince(new URL(request.url).searchParams.get("since"), Date.now());
  if (!since.ok) return erpJson({ error: since.error }, 400);

  const db = supabaseAdmin();
  const [m, booked] = await Promise.all([
    db
      .from("meetings")
      .select("id, kind, title, happened_at, duration_sec, organizer_email, process_status, client_name_guess, clients(name)")
      .in("type", ["client", "vendor"])
      .eq("process_status", "done")
      .gte("happened_at", since.since.toISOString())
      .order("happened_at")
      .order("id")
      .limit(MAX_CALLS_PER_READ),
    db.from("client_meeting_bookings").select("meeting_id").not("meeting_id", "is", null),
  ]);
  if (m.error || booked.error) return erpJson({ error: `Couldn't read the calls: ${(m.error ?? booked.error)!.message}` }, 500);

  // A meeting booked through Call to Action is Sync's already, read by its booking.
  const bookedIds = new Set((booked.data ?? []).map((b) => b.meeting_id as string));
  const rows = (m.data ?? []).filter((r) => !bookedIds.has(r.id));
  if (!rows.length) return erpJson({ calls: [] });
  const ids = rows.map((r) => r.id);

  const [s, a, pc] = await Promise.all([
    db.from("sheets").select("meeting_id").in("meeting_id", ids).eq("status", "ready"),
    db
      .from("action_items")
      .select("id, meeting_id, title, details, owed_by, owner_email, owner_name, due_date, priority, status, evidence_ts_sec, evidence_speaker, evidence_quote, position")
      .in("meeting_id", ids)
      .order("position"),
    db.from("phone_calls").select("meeting_id, counterpart_name, line_id").in("meeting_id", ids),
  ]);
  if (s.error || a.error || pc.error) return erpJson({ error: `Couldn't read the calls: ${(s.error ?? a.error ?? pc.error)!.message}` }, 500);

  const lineIds = [...new Set((pc.data ?? []).map((p) => p.line_id))];
  const lineName = new Map<string, string>();
  const lineMembers = new Map<string, string[]>();
  if (lineIds.length) {
    const [lines, members] = await Promise.all([
      db.from("phone_lines").select("id, callyzer_name, label").in("id", lineIds),
      db.from("phone_line_members").select("line_id, people(email, active)").in("line_id", lineIds),
    ]);
    if (lines.error || members.error) return erpJson({ error: `Couldn't read the lines: ${(lines.error ?? members.error)!.message}` }, 500);
    for (const l of lines.data ?? []) lineName.set(l.id, l.label ?? l.callyzer_name);
    for (const r of (members.data ?? []) as unknown as { line_id: string; people: { email: string; active: boolean } | null }[]) {
      if (!r.people?.active) continue;
      lineMembers.set(r.line_id, [...(lineMembers.get(r.line_id) ?? []), r.people.email]);
    }
  }

  const ready = new Set((s.data ?? []).map((r) => r.meeting_id));
  const phone = new Map((pc.data ?? []).map((p) => [p.meeting_id, p]));
  const items = new Map<string, ErpActionItem[]>();
  for (const row of a.data ?? []) {
    if (!ready.has(row.meeting_id) || !goesToErp(row)) continue;
    items.set(row.meeting_id, [
      ...(items.get(row.meeting_id) ?? []),
      {
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
      },
    ]);
  }

  const calls: ErpCall[] = rows
    .filter((r) => (items.get(r.id) ?? []).length > 0)
    .map((r) => {
      const p = phone.get(r.id);
      const kind = r.kind === "call" ? "call" : "meeting";
      const client = r.clients as unknown as { name: string } | null;
      return {
        id: r.id,
        kind,
        title: r.title,
        happened_at: r.happened_at,
        duration_sec: r.duration_sec,
        client_name: client?.name ?? r.client_name_guess ?? null,
        counterpart_name: p?.counterpart_name ?? null,
        line_name: p ? (lineName.get(p.line_id) ?? null) : null,
        line_member_emails: p ? (lineMembers.get(p.line_id) ?? []) : [],
        organizer_email: r.organizer_email,
        process_status: r.process_status,
        url: `${siteUrl()}/${kind === "call" ? "calls" : "meetings"}/${r.id}`,
        items: items.get(r.id) ?? [],
      };
    });

  return erpJson({ calls });
}
