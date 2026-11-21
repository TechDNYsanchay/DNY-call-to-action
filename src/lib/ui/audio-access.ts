// Who may play or download a call's recording, and what the player is told about it. Pure, so the audio
// route, the call page and the tests agree. A business call (client or vendor) is open to every active
// person, like a meeting; until a call is confirmed as business, only admins and the people on its line
// get the audio. A deleted recording (not a work call, or past the 30-day retention) is never signed.

import { istDate, formatTimeIst } from "@/lib/format";
import type { MeetingType } from "./status";

export const isBusinessType = (type: MeetingType | string | null | undefined): boolean => type === "client" || type === "vendor";

export type AudioDenial = "not_work" | "deleted" | "not_classified";

export interface AudioAccessInput {
  purgedAt: string | null;
  recordingStatus: string;
  path: string | null;
  type: MeetingType;
  isAdmin: boolean;
  isLineMember: boolean;
}

/** purged -> 409 not_work; no stored object -> 409 deleted; undecided and not theirs -> 403; else ok. */
export function decideAudioAccess(i: AudioAccessInput): { ok: true } | { ok: false; status: 403 | 409; reason: AudioDenial } {
  if (i.purgedAt) return { ok: false, status: 409, reason: "not_work" };
  if (i.recordingStatus !== "stored" || !i.path) return { ok: false, status: 409, reason: "deleted" };
  if (!isBusinessType(i.type) && !i.isAdmin && !i.isLineMember) return { ok: false, status: 403, reason: "not_classified" };
  return { ok: true };
}

/** What the page tells the player on every render; anything but "stored" stops and hides it. */
export type RecordingAvailability = "stored" | "not_work" | "deleted" | "unplayable" | "withheld";

export function recordingAvailability(i: Omit<AudioAccessInput, "isAdmin" | "isLineMember"> & { playable: boolean; canSeeUndecided: boolean }): RecordingAvailability {
  if (i.purgedAt) return "not_work";
  if (i.recordingStatus !== "stored" || !i.path) return "deleted";
  if (!isBusinessType(i.type) && !i.canSeeUndecided) return "withheld";
  return i.playable ? "stored" : "unplayable";
}

const EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/amr": "amr",
  "audio/3gpp": "3gp",
};

/** "mp3" for audio/mpeg; "audio" when the type is unknown. */
export const audioExtension = (mime: string | null | undefined): string => (mime && EXTENSIONS[mime.toLowerCase()]) || "audio";

/** "MP3", for the recording's details. */
export const audioFormatName = (mime: string | null | undefined): string => {
  const ext = audioExtension(mime);
  return ext === "audio" ? "Audio" : ext.toUpperCase();
};

/** The download's file name from the call's IST time: "call-2026-11-18-1140.mp3". No number, no name. */
export function downloadFileName(happenedAtIso: string, mime: string | null | undefined): string {
  return `call-${istDate(happenedAtIso)}-${formatTimeIst(happenedAtIso).replace(":", "")}.${audioExtension(mime)}`;
}
