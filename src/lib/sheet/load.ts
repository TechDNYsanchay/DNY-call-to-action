import "server-only";
import type { ConversationKind } from "@/lib/ingest/decisions";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import type { Database, Json } from "@/lib/supabase/database.types";
import { type Db, supabaseAdmin } from "@/lib/supabase/server";
import { MAX_KNOWN_CLIENTS } from "./package-call";
import type { LineParticipant, RosterPerson } from "./transcript-lines";

export type MeetingRow = Database["public"]["Tables"]["meetings"]["Row"];
type ParticipantRow = Database["public"]["Tables"]["participants"]["Row"];

export interface ClientSummary {
  id: string;
  name: string;
  status: string;
  domains: string[];
  contact_emails: string[];
}

/**
 * What the routine and the sheet checks need to know about a phone call besides its transcript. Never a
 * phone number: earlier calls with the same party are found inside the database (previous_business_call).
 */
export interface CallContext {
  direction: "incoming" | "outgoing";
  /** The DNY phone: its label, else its Callyzer name; the active people on it, with their department. */
  line: { id: string; name: string; people: Array<{ name: string; email: string; role: string | null }>; salesGetSheets: boolean };
  /** The contact name saved on that phone (call_log.counterpart_name); informal, may be null. */
  savedName: string | null;
  /** The newest other call with this number that is still a client or vendor call. */
  previouslyBusiness: { type: "client" | "vendor"; client: string | null } | null;
  /** Distinct voices in the transcript; one means only one side was recorded. */
  speakers: number;
  oneSided: boolean;
  /** Clients' names, by name, at most MAX_KNOWN_CLIENTS: the package's list (the holds read every name). */
  knownClients: string[];
  purgedAt: string | null;
}

/** Everything the package builder and the sheet checks need about one meeting, loaded once. */
export interface MeetingContext {
  meeting: MeetingRow;
  client: ClientSummary | null;
  participants: ParticipantRow[];
  turns: SpeakerTurn[];
  /** Active DNY people: canonical names and departments for speaker mapping and owner checks. */
  roster: RosterPerson[];
  /** Phone calls only (meetings.kind = 'call'); null for a meeting. */
  call: CallContext | null;
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
export function participantSide(p: { email: string | null; domain: string | null; is_dny: boolean }, meeting: Pick<MeetingRow, "type" | "type_source">, client: ClientSummary | null): LineParticipant["side"] {
  if (p.is_dny) return "dny";
  if (client && ((p.email ? client.contact_emails.includes(p.email) : false) || (p.domain ? client.domains.includes(p.domain) : false))) return "client";
  if (classificationDecided(meeting) && meeting.type === "client") return "client";
  return "unknown";
}

/** Whether a row is a tl;dv meeting or a phone call; null when there is no such row. */
export async function meetingKindOf(meetingId: string): Promise<ConversationKind | null> {
  const { data, error } = await supabaseAdmin().from("meetings").select("kind").eq("id", meetingId).maybeSingle();
  if (error) throw new Error(`meetings: ${error.message}`);
  if (!data) return null;
  return data.kind === "call" ? "call" : "meeting";
}

export async function loadMeetingContext(meetingId: string): Promise<MeetingContext | null> {
  const db = supabaseAdmin();
  const { data: meeting, error } = await db.from("meetings").select("*").eq("id", meetingId).maybeSingle();
  if (error) throw new Error(`meetings: ${error.message}`);
  if (!meeting) return null;
  const isCall = meeting.kind === "call";
  const [participants, transcript, secretTranscript, roster, client] = await Promise.all([
    db.from("participants").select("*").eq("meeting_id", meetingId).order("is_organizer", { ascending: false }),
    db.from("transcripts").select("turns").eq("meeting_id", meetingId).maybeSingle(),
    // A call nobody has yet confirmed as business keeps its turns in the secret store (mark_call_business moves them).
    isCall ? db.from("call_transcripts").select("turns").eq("meeting_id", meetingId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("people").select("full_name, email, dept").eq("active", true),
    meeting.client_id ? db.from("clients").select("id, name, status, domains, contact_emails").eq("id", meeting.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [participants, transcript, secretTranscript, roster, client]) if (r.error) throw new Error(`load meeting: ${r.error.message}`);
  const turns = parseTurns(transcript.data?.turns ?? secretTranscript.data?.turns ?? null);
  return {
    meeting,
    client: client.data,
    participants: participants.data ?? [],
    turns,
    roster: roster.data ?? [],
    call: isCall ? await loadCallContext(db, meeting, turns) : null,
  };
}

const asDirection = (value: string): CallContext["direction"] => (value === "outgoing" ? "outgoing" : "incoming");

/**
 * The newest other call with the same number that is still a client or vendor call, or null. The database
 * matches the number (F25): the request carries only the call's id, so the number never reaches a request log.
 */
export async function previousBusinessCall(db: Db, meetingId: string): Promise<CallContext["previouslyBusiness"]> {
  const { data, error } = await db.rpc("previous_business_call", { p_meeting_id: meetingId });
  if (error) throw new Error(`load call: earlier calls: ${error.message}`);
  const earlier = data?.[0];
  if (!earlier || (earlier.type !== "client" && earlier.type !== "vendor")) return null;
  return { type: earlier.type, client: earlier.type === "client" ? earlier.client ?? null : null };
}

/**
 * The call's facts (secret-key client): its line and people, the saved contact name, whether an earlier
 * call with the same number was business, and the first MAX_KNOWN_CLIENTS clients' names. One round.
 */
export async function loadCallContext(db: Db, meeting: MeetingRow, turns: SpeakerTurn[] = []): Promise<CallContext> {
  const [facts, ledger, clients, previouslyBusiness] = await Promise.all([
    db
      .from("phone_calls")
      .select("direction, speaker_count, purged_at, line:phone_lines(id, label, callyzer_name, sales_get_sheets, members:phone_line_members(person:people(full_name, email, dept, active)))")
      .eq("meeting_id", meeting.id)
      .maybeSingle(),
    db.from("call_log").select("counterpart_name").eq("meeting_id", meeting.id).maybeSingle(),
    db.from("clients").select("name").order("name").limit(MAX_KNOWN_CLIENTS),
    previousBusinessCall(db, meeting.id),
  ]);
  for (const r of [facts, ledger, clients]) if (r.error) throw new Error(`load call: ${r.error.message}`);
  if (!facts.data) throw new Error("load call: the call has no phone_calls row");
  const line = facts.data.line;
  const people = (line?.members ?? [])
    .map((m) => m.person)
    .filter((p): p is NonNullable<typeof p> => !!p && p.active)
    .map((p) => ({ name: p.full_name, email: p.email, role: p.dept }));

  const speakers = turns.length ? new Set(turns.map((t) => t.speaker)).size : facts.data.speaker_count ?? 0;
  return {
    direction: asDirection(facts.data.direction),
    line: { id: line?.id ?? "", name: line?.label ?? line?.callyzer_name ?? "", people, salesGetSheets: Boolean(line?.sales_get_sheets) },
    savedName: ledger.data?.counterpart_name ?? null,
    previouslyBusiness,
    speakers,
    oneSided: speakers <= 1,
    knownClients: (clients.data ?? []).map((c) => c.name),
    purgedAt: facts.data.purged_at,
  };
}

export const toLineParticipants = (ctx: MeetingContext): LineParticipant[] =>
  ctx.participants.map((p) => ({ name: p.name, email: p.email, side: participantSide(p, ctx.meeting, ctx.client) }));
