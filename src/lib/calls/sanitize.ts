// Every calls log line and every stored error text goes through here. Recording links are bearer URLs
// that never expire and numbers are personal data: neither may reach pipeline_events, the console, or an
// error column. Pure.

import { redactPhones } from "@/lib/phone";

export const LOG_TEXT_MAX = 300;

/** Links become "[link]", phone numbers their mask, and the text is cut to 300 characters. */
export function sanitizeForLog(text: string): string {
  return redactPhones(text.replace(/https?:\/\/\S+/gi, "[link]")).slice(0, LOG_TEXT_MAX);
}

/** A PostgREST error as "code message" only: never its details, hint or rows (they can carry values). */
export function pgErrorText(e: { code?: string | null; message: string }): string {
  return sanitizeForLog(`${e.code ?? ""} ${e.message}`.trim());
}

/** Any thrown value as sanitised text (its message only, never a stack or a cause). */
export function errorText(error: unknown): string {
  return sanitizeForLog(error instanceof Error ? error.message : String(error));
}
