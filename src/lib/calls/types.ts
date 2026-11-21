// Shapes shared by the calls pipeline: the pure modules here, the job and the screens. No logic.

import type { SpeakerTurn } from "@/lib/tldv/turns";

export type { SpeakerTurn };

export type CallDirection = "incoming" | "outgoing";

/** One word as Deepgram returns it (results.channels[0].alternatives[0].words[]). */
export interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  /** Deepgram's voice id; missing means 0. */
  speaker?: number;
}

export type AudioFormat = "mp3" | "m4a" | "wav" | "ogg" | "amr" | "3gp";

/** A registered phone line as the poll sees it (read with the secret key, keyed by its number). */
export interface LineState {
  id: string;
  enabled: boolean;
  /** Calls that started before this instant are never analysed: the moment the line was switched on. */
  analyseFrom: string | null;
}

/** What the intake rules made of one Callyzer row. Only candidates are stored; the rest is counted. */
export type CallOutcome = "candidate" | "not_connected" | "invalid_line" | "line_off" | "before_line_on" | "short" | "too_long" | "internal";

/** A call_log row as upsert_call_log takes it. */
export interface LedgerRow {
  callyzer_id: string;
  line_id: string;
  direction: CallDirection;
  call_started_at: string;
  duration_sec: number;
  counterpart_e164: string | null;
  counterpart_masked: string;
  counterpart_name: string | null;
  recording_url: string | null;
}

export interface CallVerdict {
  outcome: CallOutcome;
  /** The registered line the call was made on (on or off); null when the line is unknown or invalid. */
  lineId: string | null;
  /** The line is registered and switched on. */
  lineOn: boolean;
  /** Present for candidates only. */
  ledger?: LedgerRow;
}

/** A verdict plus the facts of the row that today's counts need. */
export interface ClassifiedRow extends CallVerdict {
  callyzerId: string;
  startedAt: string;
  withLink: boolean;
}

/** Today's (IST) Callyzer rows on lines that are on, as counted by the last poll. Overwritten every run. */
export interface TodayStats {
  /** YYYY-MM-DD in IST. */
  day: string;
  onLines: number;
  candidates: number;
  /** Includes calls that never connected (missed, rejected). */
  short: number;
  tooLong: number;
  internal: number;
  beforeOn: number;
  /** Per line id: every call, the candidates, and the candidates that already have a recording link. */
  lines: Record<string, { calls: number; candidates: number; withLink: number }>;
}

/** A team member as the line-member matcher needs one. */
export interface PersonLite {
  id: string;
  full_name: string;
  email: string;
  active?: boolean;
}

/** One call-history request: IST days, inclusive. `rereadDay` ties it to an admin's "Re-read a day" request. */
export interface DayWindow {
  from: string;
  to: string;
  rereadDay: string | null;
}
