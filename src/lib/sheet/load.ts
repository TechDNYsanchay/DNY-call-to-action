import "server-only";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import type { Database, Json } from "@/lib/supabase/database.types";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { LineParticipant, RosterPerson } from "./transcript-lines";

type MeetingRow = Database["public"]["Tables"]["meetings"]["Row"];
type ParticipantRow = Database["public"]["Tables"]["participants"]["Row"];

export interface ClientSummary {
  id: string;
  name: string;
  status: string;
  domains: string[];
  contact_emails: string[];
}

/** Everything the package builder and the sheet checks need about one meeting, loaded once. */
export interface MeetingContext {
  meeting: MeetingRow;
  client: ClientSummary | null;
  participants: ParticipantRow[];
  turns: SpeakerTurn[];
  /** Active DNY people: canonical names and departments for speaker mapping and owner checks. */
  roster: RosterPerson[];
}

/** The stored turns, defensively: a bad row never crashes the API, it just yields no lines. */
export function parseTurns(value: Json | null): SpeakerTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: SpeakerTurn[] = [];
  for (const raw of value) {
    const t = (raw ?? {}) as Record<string, unknown>;
    const startSec = Number(t.startSec);
    if (typeof t.text !== "string" || !t.text.trim() || !Number.isFinite(startSec)) continue;
    const endSec = Number(t.endSec);
    turns.push({ speaker: typeof t.speaker === "string" && t.speaker.trim() ? t.speaker : "Unknown speaker", startSec, endSec: Number.isFinite(endSec) ? Math.max(startSec, endSec) : startSec, text: t.text });
  }
  return turns.sort((a, b) => a.startSec - b.startSec);
}

/** Whether the rules or a person have already settled the meeting type. */
export const classificationDecided = (m: Pick<MeetingRow, "type" | "type_source">): boolean => m.type_source === "human" || (m.type_source === "rule" && m.type !== "unknown");

/** A participant's side: DNY by email, client when the record (or a decided client label) says so. */
export function participantSide(p: Pick<ParticipantRow, "email" | "domain" | "is_dny">, meeting: Pick<MeetingRow, "type" | "type_source">, client: ClientSummary | null): LineParticipant["side"] {
  if (p.is_dny) return "dny";
  if (client && (client.contact_emails.includes(p.email) || (p.domain ? client.domains.includes(p.domain) : false))) return "client";
  if (classificationDecided(meeting) && meeting.type === "client") return "client";
  return "unknown";
}

export async function loadMeetingContext(meetingId: string): Promise<MeetingContext | null> {
  const db = supabaseAdmin();
  const { data: meeting, error } = await db.from("meetings").select("*").eq("id", meetingId).maybeSingle();
  if (error) throw new Error(`meetings: ${error.message}`);
  if (!meeting) return null;
  const [participants, transcript, roster, client] = await Promise.all([
    db.from("participants").select("*").eq("meeting_id", meetingId).order("is_organizer", { ascending: false }),
    db.from("transcripts").select("turns").eq("meeting_id", meetingId).maybeSingle(),
    db.from("people").select("full_name, email, dept").eq("active", true),
    meeting.client_id ? db.from("clients").select("id, name, status, domains, contact_emails").eq("id", meeting.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [participants, transcript, roster, client]) if (r.error) throw new Error(`load meeting: ${r.error.message}`);
  return {
    meeting,
    client: client.data,
    participants: participants.data ?? [],
    turns: parseTurns(transcript.data?.turns ?? null),
    roster: roster.data ?? [],
  };
}

export const toLineParticipants = (ctx: MeetingContext): LineParticipant[] =>
  ctx.participants.map((p) => ({ name: p.name, email: p.email, side: participantSide(p, ctx.meeting, ctx.client) }));
