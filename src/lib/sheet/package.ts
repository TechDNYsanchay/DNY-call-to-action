import "server-only";
import type { ConversationKind } from "@/lib/ingest/decisions";
import { formatDuration, formatLongDateIst, formatTimeIst, formatTimestamp, istDate } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase/server";
import exampleCallSheet from "../../../agent/example-call-sheet.json";
import exampleSheet from "../../../agent/example-sheet.json";
import { classificationDecided, loadMeetingContext, type MeetingContext, participantSide, toLineParticipants } from "./load";
import { type CallBlock, callBlockOf, callClassificationDecided, languageNoteFor } from "./package-call";
import { callClassificationJsonSchema, classificationJsonSchema, sheetJsonSchema } from "./schema";
import { logAgentRun, readAgentSettings } from "./settings";
import { buildTranscriptLines } from "./transcript-lines";

/**
 * The single document the routine needs to work on one meeting or phone call. Everything else is in the
 * guide. A meeting's package is what it always was plus `meeting.kind`, `call: null` and `claim`.
 */
export interface WorkPackage {
  meeting: {
    id: string;
    /** "meeting" (tl;dv) or "call" (a phone call recorded on a DNY phone; see `call`). */
    kind: ConversationKind;
    title: string | null;
    /** e.g. "Tuesday 4 November 2026, 10:30 IST" */
    dateIst: string;
    /** The meeting's calendar date in IST, for due-date arithmetic. */
    dateIsoIst: string;
    durationSec: number;
    /** "42 min" for a meeting, "4:12" for a call. */
    durationText: string;
    tldvUrl: string | null;
    client: { name: string; status: string } | null;
    attempt: number;
  };
  /** Phone calls only: the line, the other party's saved name, earlier calls, known clients. Never a number. */
  call: CallBlock | null;
  /** This claim's token (meetings.claim_token): echo it as &claim= on classify, save, skip and release. */
  claim: string | null;
  participants: { name: string | null; side: "dny" | "client" | "unknown"; role: string | null; emailDomain: string }[];
  classification: { decided: boolean; type: string; source: string | null; confidence: number | null; reason: string | null; threshold: number };
  language: { hint: string; speakerLabelsReliable: boolean; note: string };
  transcript: string[];
  resultFormat: { schema: unknown; example: unknown };
  classificationFormat: { schema: unknown };
  guide: string;
}

/** Atomically take the next ready meeting (rpc claim_next_meeting). Null when the queue is empty. */
export async function claimNext(exclude: string[]): Promise<string | null> {
  const { data, error } = await supabaseAdmin().rpc("claim_next_meeting", { p_exclude: exclude });
  if (error) throw new Error(`claim_next_meeting: ${error.message}`);
  const id = (data as string | null) ?? null;
  if (id) {
    const { data: m } = await supabaseAdmin().from("meetings").select("process_attempts").eq("id", id).maybeSingle();
    await logAgentRun(id, "claim", "ok", m?.process_attempts ?? 1, "Claimed by the routine");
  }
  return id;
}

export async function buildPackage(meetingId: string): Promise<WorkPackage | null> {
  const [ctx, settings] = await Promise.all([loadMeetingContext(meetingId), readAgentSettings()]);
  if (!ctx) return null;
  return packageOf(ctx, settings.confidenceThreshold);
}

/** The package for a loaded meeting or call. Pure: everything it needs is in the context. */
export function packageOf(ctx: MeetingContext, threshold: number): WorkPackage {
  const { meeting, client, participants, turns, roster, call } = ctx;
  const kind: ConversationKind = meeting.kind === "call" ? "call" : "meeting";
  const lines = buildTranscriptLines(turns, toLineParticipants(ctx), roster);
  const rosterByEmail = new Map(roster.map((r) => [r.email, r]));
  return {
    meeting: {
      id: meeting.id,
      kind,
      title: meeting.title,
      dateIst: `${formatLongDateIst(meeting.happened_at)}, ${formatTimeIst(meeting.happened_at)} IST`,
      dateIsoIst: istDate(meeting.happened_at),
      durationSec: meeting.duration_sec,
      durationText: kind === "call" ? formatTimestamp(meeting.duration_sec) : formatDuration(meeting.duration_sec),
      tldvUrl: meeting.tldv_url,
      client: client ? { name: client.name, status: client.status } : null,
      attempt: meeting.process_attempts,
    },
    call: call ? callBlockOf(call) : null,
    claim: meeting.claim_token,
    // A call has no participant rows: the routine maps the speaker labels itself (guide, Phone calls).
    participants:
      kind === "call"
        ? []
        : participants.map((p) => ({
            name: p.name,
            side: participantSide(p, meeting, client),
            role: p.is_dny ? rosterByEmail.get(p.email)?.dept ?? null : null,
            emailDomain: p.domain ?? p.email?.split("@")[1] ?? "",
          })),
    classification: {
      decided: kind === "call" ? callClassificationDecided(meeting.type) : classificationDecided(meeting),
      type: meeting.type,
      source: meeting.type_source,
      confidence: meeting.type_confidence,
      reason: meeting.type_reason,
      threshold,
    },
    language: { hint: lines.language.hint, speakerLabelsReliable: lines.speakerLabelsReliable, note: languageNoteFor(kind, lines.language.hint, lines.speakerLabelsReliable) },
    transcript: lines.lines,
    resultFormat: kind === "call" ? { schema: sheetJsonSchema("call"), example: exampleCallSheet } : { schema: sheetJsonSchema(), example: exampleSheet },
    classificationFormat: { schema: kind === "call" ? callClassificationJsonSchema() : classificationJsonSchema() },
    guide: "/api/agent/guide",
  };
}
