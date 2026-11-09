// Reads tl;dv's API and webhook formats (https://doc.tldv.io) into what the app stores. Pure, so it
// can be tested against the documented shapes. Adapted from DNY's sales agent.

import { DNY_EMAIL_DOMAIN } from "@/lib/env";
import { mergeTurns, type SpeakerTurn } from "./turns";

export interface TldvPerson {
  name: string | null;
  email: string | null;
}

export interface TldvMeeting {
  /** tl;dv's meeting id, stored as meetings.tldv_meeting_id. */
  id: string;
  title: string | null;
  /** ISO timestamp the meeting happened (UTC). */
  happenedAt: string;
  durationSec: number;
  organizer: TldvPerson;
  invitees: TldvPerson[];
  /** The meeting's page in tl;dv, where the recording plays. */
  url: string | null;
  /**
   * The Google Meet code ("abc-defg-hij") from extraProperties.conferenceId. A meeting booked in this
   * app carries the code of its booking; null for other meetings or when tl;dv left it out.
   */
  meetCode: string | null;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

function person(value: unknown): TldvPerson {
  const v = (value ?? {}) as Record<string, unknown>;
  return { name: text(v.name), email: text(v.email)?.toLowerCase() ?? null };
}

/** A meeting from GET /v1alpha1/meetings/{id}, the list endpoint, or a webhook's `data`; null if unusable. */
export function parseTldvMeeting(value: unknown): TldvMeeting | null {
  const v = (value ?? {}) as Record<string, unknown>;
  const id = text(v.id);
  const happenedAt = text(v.happenedAt);
  const startedAt = happenedAt && !Number.isNaN(Date.parse(happenedAt)) ? new Date(happenedAt).toISOString() : null;
  if (!id || !startedAt) return null;
  const duration = Number(v.duration);
  const url = text(v.url);
  return {
    id,
    title: text(v.name),
    happenedAt: startedAt,
    durationSec: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
    organizer: person(v.organizer),
    invitees: Array.isArray(v.invitees) ? v.invitees.map(person) : [],
    url: url?.startsWith("https://") ? url : null,
    meetCode: parseMeetCode(((v.extraProperties ?? {}) as Record<string, unknown>).conferenceId),
  };
}

/** "https://meet.google.com/abc-defg-hij?x" or "ABC-DEFG-HIJ" -> "abc-defg-hij"; null if neither. */
export function parseMeetCode(value: unknown): string | null {
  const match = (typeof value === "string" ? value : "").toLowerCase().match(/\b([a-z]{3}-[a-z]{4}-[a-z]{3})\b/);
  return match ? match[1] : null;
}

/** Transcript turns from GET .../transcript (`{ data: [...] }`), a bare array, or the older `{ segments: [...] }` shape. */
export function parseTldvTranscript(value: unknown): SpeakerTurn[] | null {
  const v = value as Record<string, unknown> | unknown[] | null;
  const lines = Array.isArray(v)
    ? v
    : Array.isArray((v as Record<string, unknown>)?.data)
      ? ((v as Record<string, unknown>).data as unknown[])
      : Array.isArray((v as Record<string, unknown>)?.segments)
        ? ((v as Record<string, unknown>).segments as unknown[])
        : null;
  if (!lines) return null;
  const sentences: SpeakerTurn[] = [];
  for (const line of lines) {
    const l = (line ?? {}) as Record<string, unknown>;
    const start = Number(l.startTime);
    const end = Number(l.endTime);
    const words = text(l.text);
    if (!words || !Number.isFinite(start)) continue;
    sentences.push({ speaker: text(l.speaker) ?? "Unknown speaker", startSec: start, endSec: Number.isFinite(end) ? Math.max(start, end) : start, text: words });
  }
  return mergeTurns(sentences);
}

export interface TldvWebhook {
  /** tl;dv's payload id, used to ignore repeated deliveries. */
  id: string | null;
  event: string;
  executedAt: string | null;
  meetingId: string;
  /** Present on MeetingReady (metadata); TranscriptReady carries only the transcript. */
  meeting: TldvMeeting | null;
  /** Present when tl;dv embedded it (TranscriptReady, or MeetingReady with the transcript included). */
  transcript: SpeakerTurn[] | null;
}

export function parseTldvWebhook(value: unknown): TldvWebhook | null {
  const v = (value ?? {}) as Record<string, unknown>;
  const event = text(v.event);
  const data = (v.data ?? {}) as Record<string, unknown>;
  if (!event) return null;
  const meeting = parseTldvMeeting(data);
  // TranscriptReady: data = { id: transcriptId, meetingId, data: [...] }
  const meetingId = meeting?.id ?? text(data.meetingId);
  if (!meetingId) return null;
  const embedded = meeting ? (data.transcript ?? null) : data;
  const transcript = embedded ? parseTldvTranscript(embedded) : null;
  return { id: text(v.id), event, executedAt: text(v.executedAt), meetingId, meeting, transcript: transcript?.length ? transcript : null };
}

export const isDnyEmail = (email: string | null | undefined): boolean => !!email && email.toLowerCase().endsWith(`@${DNY_EMAIL_DOMAIN}`);

/** The people outside DNY on the invite. */
export function externalsOf(meeting: TldvMeeting): TldvPerson[] {
  return meeting.invitees.filter((p) => p.email && !isDnyEmail(p.email));
}
