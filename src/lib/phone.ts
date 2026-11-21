// Phone numbers from Callyzer: strict E.164, the masked forms people see, the redaction every calls
// log line goes through, and names with any number taken out. Pure. A full number only ever lives in
// call_log (secret key only); screens, logs and stored errors get the mask.

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Callyzer sends a country code and a number separately. Returns "+919820123456", or null when the
 * result is not a real E.164 number (Indian numbers need exactly 10 digits after +91). No code means
 * India; DNY's own phones are always Indian numbers.
 */
export function toE164Strict(cc: string | number | null | undefined, n: string | number | null | undefined): string | null {
  const digits = String(n ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const code = String(cc ?? "").replace(/\D/g, "") || "91";
  const e164 = digits.length > 10 && digits.startsWith(code) ? `+${digits}` : `+${code}${digits.replace(/^0+/, "")}`;
  if (!E164.test(e164)) return null;
  if (e164.startsWith("+91") && e164.length !== 13) return null;
  return e164;
}

const MASK = "••• ••";

/** "+919820123456" -> "+91 98••• ••456"; other countries keep their first three characters and last three digits. */
export function maskPhone(e164: string): string {
  if (e164.startsWith("+91") && e164.length === 13) return `+91 ${e164.slice(3, 5)}${MASK}${e164.slice(-3)}`;
  return `${e164.slice(0, 3)} ${MASK}${e164.slice(-3)}`;
}

/** Digits that are not a valid number: at least half stay hidden, never more than three show at either end. */
function maskDigits(digits: string): string {
  const show = Math.min(3, Math.floor(digits.length / 4));
  return `${digits.slice(0, show)}${MASK}${digits.slice(digits.length - show)}`;
}

/**
 * The other party as people see it: the masked valid number, a short code (6 digits or fewer) as it
 * is, other digits masked, and "Hidden number" when the phone showed none ("", "Private", ...).
 */
export function maskCounterpart(cc: string | number | null | undefined, raw: string | number | null | undefined): string {
  const e164 = toE164Strict(cc, raw);
  if (e164) return maskPhone(e164);
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "Hidden number";
  if (digits.length <= 6) return digits;
  return maskDigits(digits);
}

// 10-15 digits (with an optional +) that touch no letter, digit or hyphen: a UUID's last group, a date or
// an id inside a word is never taken for a phone number.
const PHONE_RUN = /(?<![\p{L}\p{N}+-])\+?\d{10,15}(?![\p{L}\p{N}-])/gu;

/** Every phone-number-like run of digits in a text, replaced by its mask. */
export function redactPhones(text: string): string {
  return text.replace(PHONE_RUN, (run) => maskCounterpart("91", run));
}

// A number written into a name: 7 or more digits, spaces, brackets, dots and dashes ("+91 98201 23456").
// register_phone_lines (SQL) removes the same pattern from line names.
const NUMBER_IN_NAME = /\+?\d[\d\s().-]{5,}\d/g;

/**
 * A name without any phone number in it, or null when no letter is left: a contact saved as
 * "+91 98201 23456", or a line Callyzer names by its number, has no name, so a full number never
 * reaches a title, a screen or the routine's package. At most 120 characters.
 */
export function nameWithoutNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = raw.replace(NUMBER_IN_NAME, " ").replace(/\s+/g, " ").trim();
  return /\p{L}/u.test(name) ? name.slice(0, 120) : null;
}

/**
 * The digits of a number search, or null when there are fewer than 7 (too broad to search by). A
 * leading 0 or 91 in front of a 10-digit number is dropped, so "+91 98201 23456" finds 9820123456.
 */
export function normalizeDigitQuery(q: string): string | null {
  let digits = q.replace(/\D/g, "");
  if ((digits.length === 11 && digits.startsWith("0")) || (digits.length === 12 && digits.startsWith("91"))) digits = digits.slice(-10);
  return digits.length >= 7 ? digits : null;
}
