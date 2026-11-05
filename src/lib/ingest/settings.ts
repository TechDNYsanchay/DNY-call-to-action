// The settings table holds JSON values ('false', '5', '0.8'); this reads them with defaults so the
// cron never breaks because a row is missing or someone saved a number as a string.

import type { Json } from "@/lib/supabase/database.types";
import type { Db } from "@/lib/supabase/server";

export interface Settings {
  pipeline_paused: boolean;
  max_per_run: number;
  confidence_threshold: number;
  retention_months: number;
  claim_timeout_minutes: number;
  max_attempts: number;
}

export const DEFAULT_SETTINGS: Settings = {
  pipeline_paused: false,
  max_per_run: 5,
  confidence_threshold: 0.8,
  retention_months: 12,
  claim_timeout_minutes: 90,
  max_attempts: 3,
};

const asNumber = (value: Json | undefined, fallback: number): number => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const asBoolean = (value: Json | undefined, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};

/** Rows from `select key, value from settings` -> typed settings with defaults for anything missing. */
export function parseSettings(rows: Array<{ key: string; value: Json }>): Settings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    pipeline_paused: asBoolean(map.get("pipeline_paused"), DEFAULT_SETTINGS.pipeline_paused),
    max_per_run: asNumber(map.get("max_per_run"), DEFAULT_SETTINGS.max_per_run),
    confidence_threshold: asNumber(map.get("confidence_threshold"), DEFAULT_SETTINGS.confidence_threshold),
    retention_months: asNumber(map.get("retention_months"), DEFAULT_SETTINGS.retention_months),
    claim_timeout_minutes: asNumber(map.get("claim_timeout_minutes"), DEFAULT_SETTINGS.claim_timeout_minutes),
    max_attempts: asNumber(map.get("max_attempts"), DEFAULT_SETTINGS.max_attempts),
  };
}

/** Reads the settings table with a Supabase client (the admin client in cron and webhook routes). */
export async function readSettings(db: Db): Promise<Settings> {
  const { data, error } = await db.from("settings").select("key, value");
  if (error || !data) return DEFAULT_SETTINGS;
  return parseSettings(data);
}
