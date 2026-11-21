import "server-only";

// The calls job's real dependencies: its own database client (timeouts, no retries), the global fetch,
// the clock, the three keys from the environment, the routine starter, and a logger that sanitises
// every line before it reaches pipeline_events or the console.

import { optionalEnv } from "@/lib/env";
import { type EventLevel, logEvent } from "@/lib/ingest/intake";
import { startRoutine } from "@/lib/routine";
import { TIMEOUT_MS } from "./budget";
import { callsDb } from "./db";
import { type CallsDeps, withTimeout } from "./deps";
import { removeRecordingObjects } from "./purge";
import { sanitizeForLog } from "./sanitize";

/** logEvent with links and numbers taken out; bounded, so a slow log never holds up the job. */
export async function callsLog(level: EventLevel, step: string, message: string, meetingId?: string | null): Promise<void> {
  await withTimeout(
    logEvent(level, step, sanitizeForLog(message), meetingId).catch(() => undefined),
    TIMEOUT_MS.db,
  );
}

export function serverCallsDeps(): CallsDeps {
  const db = callsDb();
  return {
    db,
    // Looked up at call time, like every other fetch in the app.
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    env: {
      callyzerBase: optionalEnv("CALLYZER_API_BASE"),
      callyzerKey: optionalEnv("CALLYZER_API_KEY"),
      deepgramKey: optionalEnv("DEEPGRAM_API_KEY"),
      supabaseUrl: optionalEnv("NEXT_PUBLIC_SUPABASE_URL"),
    },
    startRoutine,
    log: callsLog,
    removeObjects: (paths) => removeRecordingObjects(db, paths),
  };
}
