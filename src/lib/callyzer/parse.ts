// Callyzer's call-history API (POST /admin/api/call/callHistory): the envelope and one row per call,
// with the field names verified live on 19 Nov 2026. Ported from Sales QA's src/lib/callyzer.ts. Pure:
// the parser only reads; which rows become candidates is decided in src/lib/calls/rules.ts.

import { z } from "zod";
import { nameWithoutNumber } from "@/lib/phone";

export interface CallyzerRow {
  /** Callyzer's call id, trimmed (65 characters in practice). */
  uniqueId: string;
  /** The DNY phone line's name, e.g. "keyur dny supply chain", without any phone number in it; null when no letter is left. */
  employeeName: string | null;
  /** The DNY phone's number as Callyzer sends it (string or number); always an Indian number. */
  employeeNumber: string;
  /** The contact name saved on the DNY phone; "", "unknown" and "null" become null. */
  clientName: string | null;
  /** The other party's country code (the DNY phone's is always 91). */
  countryCode: string | null;
  clientNumber: string | null;
  /** "19 Nov 2026" + "02:06 PM" (the phone's time, India) -> "2026-11-19T14:06:00+05:30". */
  startedAt: string;
  durationSec: number;
  /** "Incoming" or "Outgoing" for connected calls; anything else is rejected by the rules. */
  callType: string;
  /** callRecordingPath when it is an https link, else null (no recording uploaded yet). */
  recordingUrl: string | null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** API date "19 Nov 2026" + time "02:06 PM" (the phone's local time, India) -> ISO with +05:30; null when unreadable. */
export function apiDateTimeToIso(date: string, time: string): string | null {
  const d = date.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/);
  const t = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?$/i);
  const month = d && MONTHS[d[2].toLowerCase()];
  if (!d || !t || !month) return null;
  let hour = Number(t[1]);
  const meridiem = t[4]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || Number(t[2]) > 59 || Number(t[3] ?? 0) > 59) return null;
  const [year, day] = [Number(d[3]), Number(d[1])];
  const real = new Date(Date.UTC(year, Number(month) - 1, day));
  if (real.getUTCMonth() !== Number(month) - 1 || real.getUTCDate() !== day) return null;
  return `${d[3]}-${month}-${d[1].padStart(2, "0")}T${String(hour).padStart(2, "0")}:${t[2]}:${t[3] ?? "00"}+05:30`;
}

const text = z.union([z.string(), z.number()]).nullish();

const ApiRowSchema = z.object({
  uniqueId: z.string().trim().min(1),
  employeeName: z.string().nullish(),
  employeeNumber: text,
  clientName: z.string().nullish(),
  countryCode: text,
  clientNumber: text,
  date: z.string(),
  time: z.string(),
  durationInSeconds: z.coerce.number().int().nonnegative(),
  callType: z.string().nullish(),
  callRecordingPath: z.string().nullish(),
});

const UNKNOWN_NAMES = new Set(["", "unknown", "null"]);

const asText = (value: string | number | null | undefined): string | null => {
  const s = String(value ?? "").trim();
  return s ? s : null;
};

/** The envelope { data, message, recordsTotal, recordsFiltered, srNoCounterStart }; data defaults to []. */
export function parseCallHistoryEnvelope(json: unknown): { rows: unknown[]; recordsTotal: number | null } {
  const body = (json && typeof json === "object" ? json : {}) as { data?: unknown; recordsTotal?: unknown };
  const total = typeof body.recordsTotal === "string" && body.recordsTotal.trim() ? Number(body.recordsTotal) : body.recordsTotal;
  return {
    rows: Array.isArray(body.data) ? body.data : [],
    recordsTotal: typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null,
  };
}

/** One call-history row, or why it could not be read (counted by the poll, never thrown). */
export function parseCallHistoryRow(raw: unknown): { row: CallyzerRow } | { error: string; id?: string } {
  const parsed = ApiRowSchema.safeParse(raw);
  if (!parsed.success) {
    const id = (raw as { uniqueId?: unknown } | null)?.uniqueId;
    return { error: "unreadable call-history row", ...(typeof id === "string" && id.trim() ? { id: id.trim() } : {}) };
  }
  const r = parsed.data;
  const startedAt = apiDateTimeToIso(r.date, r.time);
  if (!startedAt) return { error: "unreadable call date or time", id: r.uniqueId };
  const link = r.callRecordingPath?.trim() ?? "";
  const name = r.clientName?.trim() ?? "";
  return {
    row: {
      uniqueId: r.uniqueId,
      employeeName: nameWithoutNumber(r.employeeName),
      employeeNumber: asText(r.employeeNumber) ?? "",
      clientName: UNKNOWN_NAMES.has(name.toLowerCase()) ? null : name,
      countryCode: asText(r.countryCode),
      clientNumber: asText(r.clientNumber),
      startedAt,
      durationSec: r.durationInSeconds,
      callType: r.callType?.trim() ?? "",
      recordingUrl: link.startsWith("https://") ? link : null,
    },
  };
}
