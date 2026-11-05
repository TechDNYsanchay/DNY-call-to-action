import "server-only";
import { formatDuration, formatLongDateIst, formatTimeIst, istDate } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase/server";
import exampleSheet from "../../../agent/example-sheet.json";
import { classificationDecided, loadMeetingContext, participantSide, toLineParticipants } from "./load";
import { classificationJsonSchema, sheetJsonSchema } from "./schema";
import { logAgentRun, readAgentSettings } from "./settings";
import { buildTranscriptLines } from "./transcript-lines";

/** The single document the routine needs to work on one meeting. Everything else is in the guide. */
export interface WorkPackage {
  meeting: {
    id: string;
    title: string | null;
    /** e.g. "Tuesday 4 November 2026, 10:30 IST" */
    dateIst: string;
    /** The meeting's calendar date in IST, for due-date arithmetic. */
    dateIsoIst: string;
    durationSec: number;
    durationText: string;
    tldvUrl: string | null;
    client: { name: string; status: string } | null;
    attempt: number;
  };
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
  const { meeting, client, participants, turns, roster } = ctx;
  const lines = buildTranscriptLines(turns, toLineParticipants(ctx), roster);
  const rosterByEmail = new Map(roster.map((r) => [r.email, r]));
  const languageNote = [
    lines.language.hint === "english" ? "Mostly English." : lines.language.hint === "hindi" ? "Mostly Hindi in Devanagari script." : "Hinglish: Hindi and English mixed, mostly in Latin script.",
    lines.speakerLabelsReliable ? "Speaker labels map to known people." : "Speaker labels are unreliable (fewer than half map to a known person): mark an owner as explicitly assigned only when the name is spoken.",
  ].join(" ");
  return {
    meeting: {
      id: meeting.id,
      title: meeting.title,
      dateIst: `${formatLongDateIst(meeting.happened_at)}, ${formatTimeIst(meeting.happened_at)} IST`,
      dateIsoIst: istDate(meeting.happened_at),
      durationSec: meeting.duration_sec,
      durationText: formatDuration(meeting.duration_sec),
      tldvUrl: meeting.tldv_url,
      client: client ? { name: client.name, status: client.status } : null,
      attempt: meeting.process_attempts,
    },
    participants: participants.map((p) => ({
      name: p.name,
      side: participantSide(p, meeting, client),
      role: p.is_dny ? rosterByEmail.get(p.email)?.dept ?? null : null,
      emailDomain: p.domain ?? p.email.split("@")[1] ?? "",
    })),
    classification: {
      decided: classificationDecided(meeting),
      type: meeting.type,
      source: meeting.type_source,
      confidence: meeting.type_confidence,
      reason: meeting.type_reason,
      threshold: settings.confidenceThreshold,
    },
    language: { hint: lines.language.hint, speakerLabelsReliable: lines.speakerLabelsReliable, note: languageNote },
    transcript: lines.lines,
    resultFormat: { schema: sheetJsonSchema(), example: exampleSheet },
    classificationFormat: { schema: classificationJsonSchema() },
    guide: "/api/agent/guide",
  };
}
