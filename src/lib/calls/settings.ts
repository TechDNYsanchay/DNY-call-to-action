// The calls settings (settings table, calls_* keys) with defaults and bounds, so the job never breaks
// because a row is missing or holds a bad value. Pure. A missing calls_paused means paused: calls only
// run once an admin has switched them on.

import type { Json } from "@/lib/supabase/database.types";
import { toE164Strict } from "@/lib/phone";
import { NIGHT_POLL_CHOICES } from "./schedule";

export interface CallsSettings {
  paused: boolean;
  /** pipeline_paused: also stops transcription of calls (copies go on). */
  pipelinePaused: boolean;
  minDurationSec: number;
  maxMinutes: number;
  /** Callyzer line names switched on when first seen (read by register_phone_lines). */
  initialLines: string[];
  /** Other DNY numbers (E.164): calls with them count as internal. */
  dnyNumbers: string[];
  maxAudioMinutesPerDay: number;
  audioRetentionDays: number;
  claimTimeoutMinutes: number;
  decisionHours: number;
  undecidedFailedDays: number;
  routinePurgesPerHour: number;
  mipOptOut: boolean;
  nightPollMinutes: number;
  /** max_attempts, shared with meetings: the routine's claims on a call. Copies and transcription keep a fixed 3 (worker.ts). */
  maxAttempts: number;
}

export const DEFAULT_CALLS_SETTINGS: CallsSettings = {
  paused: true,
  pipelinePaused: false,
  minDurationSec: 45,
  maxMinutes: 90,
  initialLines: [],
  dnyNumbers: [],
  maxAudioMinutesPerDay: 240,
  audioRetentionDays: 30,
  claimTimeoutMinutes: 20,
  decisionHours: 24,
  undecidedFailedDays: 3,
  routinePurgesPerHour: 4,
  mipOptOut: true,
  nightPollMinutes: 2,
  maxAttempts: 3,
};

/** [min, max] for every number an admin can set; values outside are pulled to the nearest bound. */
export const CALLS_BOUNDS = {
  minDurationSec: [15, 600],
  maxMinutes: [30, 240],
  maxAudioMinutesPerDay: [10, 2000],
  audioRetentionDays: [1, 365],
  claimTimeoutMinutes: [10, 60],
  decisionHours: [4, 168],
  undecidedFailedDays: [1, 30],
  routinePurgesPerHour: [0, 100],
  maxAttempts: [1, 10],
} as const;

const asNumber = (value: Json | undefined): number | null => {
  const n = typeof value === "string" && value.trim() ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
};

const bounded = (value: Json | undefined, fallback: number, [min, max]: readonly [number, number]): number => {
  const n = asNumber(value);
  return n === null ? fallback : Math.min(max, Math.max(min, Math.round(n)));
};

const asBoolean = (value: Json | undefined, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};

const asStrings = (value: Json | undefined): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()) : [];

/** Rows from `select key, value from settings` -> the calls settings, defaults for anything missing or bad. */
export function parseCallsSettings(rows: Array<{ key: string; value: Json }>): CallsSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const d = DEFAULT_CALLS_SETTINGS;
  const night = asNumber(map.get("calls_night_poll_minutes"));
  return {
    paused: asBoolean(map.get("calls_paused"), d.paused),
    pipelinePaused: asBoolean(map.get("pipeline_paused"), d.pipelinePaused),
    minDurationSec: bounded(map.get("calls_min_duration_sec"), d.minDurationSec, CALLS_BOUNDS.minDurationSec),
    maxMinutes: bounded(map.get("calls_max_minutes"), d.maxMinutes, CALLS_BOUNDS.maxMinutes),
    initialLines: asStrings(map.get("calls_initial_lines")),
    dnyNumbers: [...new Set(asStrings(map.get("calls_dny_numbers")).map((n) => toE164Strict("91", n)).filter((n): n is string => n !== null))],
    maxAudioMinutesPerDay: bounded(map.get("calls_max_audio_minutes_per_day"), d.maxAudioMinutesPerDay, CALLS_BOUNDS.maxAudioMinutesPerDay),
    audioRetentionDays: bounded(map.get("calls_audio_retention_days"), d.audioRetentionDays, CALLS_BOUNDS.audioRetentionDays),
    claimTimeoutMinutes: bounded(map.get("calls_claim_timeout_minutes"), d.claimTimeoutMinutes, CALLS_BOUNDS.claimTimeoutMinutes),
    decisionHours: bounded(map.get("calls_decision_hours"), d.decisionHours, CALLS_BOUNDS.decisionHours),
    undecidedFailedDays: bounded(map.get("calls_undecided_failed_days"), d.undecidedFailedDays, CALLS_BOUNDS.undecidedFailedDays),
    routinePurgesPerHour: bounded(map.get("calls_routine_purges_per_hour"), d.routinePurgesPerHour, CALLS_BOUNDS.routinePurgesPerHour),
    mipOptOut: asBoolean(map.get("calls_deepgram_mip_opt_out"), d.mipOptOut),
    nightPollMinutes: night !== null && (NIGHT_POLL_CHOICES as readonly number[]).includes(night) ? night : d.nightPollMinutes,
    maxAttempts: bounded(map.get("max_attempts"), d.maxAttempts, CALLS_BOUNDS.maxAttempts),
  };
}
