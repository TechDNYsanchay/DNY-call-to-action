// Why a call was deleted, and why the routine gave one back, as fixed text. Pure. Nothing the routine
// wrote about a call that is not a work call is ever stored: only these sentences (no content, no digits).

export type SkipCode = "no_speech" | "personal" | "internal" | "sales" | "wrong_number" | "no_content" | "not_business" | "undecided" | "line_off";

const SKIP_REASONS: Record<Exclude<SkipCode, "not_business">, string> = {
  personal: "Personal call. The recording and transcript were deleted.",
  internal: "Call between DNY colleagues. The recording and transcript were deleted.",
  sales: "Sales lead, which Sales QA handles. The recording and transcript were deleted.",
  wrong_number: "Wrong number. The recording and transcript were deleted.",
  no_content: "No usable conversation. The recording and transcript were deleted.",
  no_speech: "No speech in the recording. The recording was deleted.",
  undecided: "Not confirmed as a work call in time. The recording and transcript were deleted.",
  line_off: "The phone line was switched off before this call was confirmed as a work call. The recording and transcript were deleted.",
};

/** The stub's reason. A person's "Not a work call" names them; the routine's does not. */
export function skipReason(code: SkipCode, byPerson?: string): string {
  if (code !== "not_business") return SKIP_REASONS[code];
  const name = byPerson?.trim().slice(0, 120);
  return name
    ? `Marked not a work call by ${name}. The recording, transcript and sheet were deleted.`
    : "Not a work call. The recording and transcript were deleted.";
}

/** The types the routine may skip a call as (POST /skip?type=...). */
export const CALL_SKIP_TYPES = ["personal", "internal", "sales", "wrong_number", "no_content", "other"] as const;

/** A non-work call type -> its skip code ("other" -> "not_business"); null for anything else. */
export function callSkipCode(type: string): SkipCode | null {
  switch (type) {
    case "personal":
    case "internal":
    case "sales":
    case "wrong_number":
    case "no_content":
      return type;
    case "other":
      return "not_business";
    default:
      return null;
  }
}

/** Why the routine gave a call back (POST /release?code=...); calls take no free text. */
export type ReleaseCode = "sheet_checks" | "empty_transcript" | "server_error" | "other";

export const RELEASE_TEXT: Record<ReleaseCode, string> = {
  sheet_checks: "The sheet kept failing the server's checks",
  empty_transcript: "The transcript was empty",
  server_error: "The server kept returning errors",
  other: "The routine could not finish this call",
};

/** A release code from the query string; missing or unknown is "other". */
export function releaseCodeOf(value: string | null | undefined): ReleaseCode {
  return value && Object.hasOwn(RELEASE_TEXT, value) ? (value as ReleaseCode) : "other";
}
