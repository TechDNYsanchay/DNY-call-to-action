import "server-only";
// The routine's work API for a phone call: classify, skip and release (the sheet is saved in save.ts). A call
// is never just relabelled like a meeting. A client or vendor call becomes team-readable (mark_call_business
// moves its turns out of the secret store and copies the saved contact name). Any other call is deleted for
// good (purge_claimed_call) or, when the routine is unsure or something looks risky (src/lib/calls/hold.ts),
// handed to a person (hold_call). Each of those writes checks the routine's claim in its own transaction, a
// person's client or vendor label always stands, and nothing the routine wrote about a call that is not a
// work call is stored or logged: only fixed text. Writes use callsDb(), which never retries, so a reply lost
// on the way back cannot apply one twice.

import { callsDb } from "@/lib/calls/db";
import { BUDGET_ALERT_PREFIX, budgetAlertText, type HoldReason, heldText, holdReasonFor, type KnownParty, knownBusinessReason, percentOf, unsureText } from "@/lib/calls/hold";
import { type PurgeRefusal, purgeCall } from "@/lib/calls/purge";
import { pgErrorText } from "@/lib/calls/sanitize";
import { type CallsSettings, parseCallsSettings } from "@/lib/calls/settings";
import { RELEASE_TEXT, type ReleaseCode, type SkipCode } from "@/lib/calls/skip";
import { isEligibleType } from "@/lib/ingest/decisions";
import { nameWithoutNumber, redactPhones } from "@/lib/phone";
import { type Db, supabaseAdmin } from "@/lib/supabase/server";
import { CALL_PURGED, CLAIM_GONE, checkCallClaim } from "./claim";
import type { ClassifyOutcome } from "./classify";
import { matchClientName, routeCallClassification } from "./classify-routing";
import { type MeetingRow, previousBusinessCall } from "./load";
import type { ReleaseOutcome } from "./release";
import { type CallClassification, CallClassificationSchema } from "./schema";
import { logAgentRun, logPipelineEvent, readAgentSettings } from "./settings";
import { zodIssues } from "./zod-issues";

/** What skip and release answer for a call: a meeting's outcome, plus a hold or a kept sheet, and the HTTP status when it is not 200/422. */
export interface CallReleaseOutcome {
  ok: boolean;
  status: ReleaseOutcome["status"] | "needs_decision" | "done";
  errors: string[];
  httpStatus?: number;
  held?: boolean;
  kept?: boolean;
}

export const HUMAN_LABEL_SKIP = "A person marked this a business call; save the sheet or release it";
export const SALES_LINE_SKIP = "Sales enquiries on this line get a sheet: classify the call as client and write the sheet, or release it";
const KEPT_TEXT = "Routine said not a work call on a re-run; the sheet was kept";
const NOT_FOUND = "Meeting not found";

/** How the routine's work on a call ended, before it is put as classify's or skip's answer. */
type Ended =
  | { kind: "purged"; code: SkipCode }
  | { kind: "held"; hold: "unsure" | "held" }
  | { kind: "kept" }
  | { kind: "labelled" }
  | { kind: "refused"; httpStatus: 409 | 422; error: string };

/** A call the routine holds a current claim on, and that claim (every write of the request checks it again). */
type Claimed = { meeting: MeetingRow; claim: string };

async function readCall(db: Db, meetingId: string): Promise<MeetingRow | null> {
  const { data, error } = await db.from("meetings").select("*").eq("id", meetingId).eq("kind", "call").maybeSingle();
  if (error) throw new Error(`meetings: ${error.message}`);
  return data;
}

/** The call, when the routine's claim on it is current; otherwise why not (422 not found or not processing, 409 claim gone). */
async function claimedCall(db: Db, meetingId: string, claim: string | null): Promise<Claimed | { refused: { httpStatus: 409 | 422; error: string } }> {
  const meeting = await readCall(db, meetingId);
  if (!meeting) return { refused: { httpStatus: 422, error: NOT_FOUND } };
  const refusal = checkCallClaim(meeting, claim);
  if (refusal || !claim) return { refused: refusal ?? { httpStatus: 409, error: CLAIM_GONE } };
  return { meeting, claim };
}

async function readCallsSettings(db: Db): Promise<CallsSettings> {
  const { data, error } = await db.from("settings").select("key, value");
  if (error) throw new Error(`settings: ${error.message}`);
  return parseCallsSettings(data ?? []);
}

/** Whether the call's line writes up sales enquiries too (Settings > Phone calls). */
async function lineSalesGetSheets(db: Db, meetingId: string): Promise<boolean> {
  const { data, error } = await db.from("phone_calls").select("line:phone_lines(sales_get_sheets)").eq("meeting_id", meetingId).maybeSingle();
  if (error) throw new Error(`phone_calls: ${error.message}`);
  const line = data?.line as { sales_get_sheets?: boolean } | { sales_get_sheets?: boolean }[] | null | undefined;
  return Boolean(Array.isArray(line) ? line[0]?.sales_get_sheets : line?.sales_get_sheets);
}

async function sheetCount(db: Db, meetingId: string): Promise<number> {
  const { count, error } = await db.from("sheets").select("id", { count: "exact", head: true }).eq("meeting_id", meetingId);
  if (error) throw new Error(`sheets: ${error.message}`);
  return count ?? 0;
}

/** Calls the routine deleted in the last hour, for the purge budget (calls_routine_purges_per_hour). */
async function routinePurgesLastHour(db: Db): Promise<number> {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error } = await db.from("phone_calls").select("meeting_id", { count: "exact", head: true }).eq("purged_by", "routine").gt("purged_at", since);
  if (error) throw new Error(`phone_calls: ${error.message}`);
  return count ?? 0;
}

/** One error an hour while the purge budget holds calls for a person, saying how many wait. */
async function budgetAlert(db: Db): Promise<void> {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { data: recent, error } = await db.from("pipeline_events").select("id").eq("level", "error").like("message", `${BUDGET_ALERT_PREFIX}%`).gte("created_at", since).limit(1);
  if (error || recent?.length) return;
  const { count } = await db
    .from("meetings")
    .select("id", { count: "exact", head: true })
    .eq("kind", "call")
    .eq("process_status", "needs_decision")
    .eq("type_reason", heldText("budget"))
    .gte("updated_at", since);
  await logPipelineEvent(null, "error", "agent", budgetAlertText(Math.max(1, count ?? 1)));
}

/** A database refusal of the routine's write (F12, F14, F24): what it means for the routine. */
function endedByRefusal(message: string): Ended | null {
  switch (message as PurgeRefusal | "call_purged") {
    case "claim_mismatch":
      return { kind: "refused", httpStatus: 409, error: CLAIM_GONE };
    case "human_label":
      return { kind: "labelled" };
    case "call_purged":
      return { kind: "refused", httpStatus: 409, error: CALL_PURGED };
    case "call_not_found":
      return { kind: "refused", httpStatus: 422, error: NOT_FOUND };
    default:
      return null;
  }
}

/** A re-run's call that already has a sheet keeps it: the routine never deletes a sheet. The call is done. */
async function keepSheet({ meeting, claim }: Claimed, runKind: "classify" | "skip"): Promise<Ended> {
  const { data, error } = await callsDb()
    .from("meetings")
    .update({ process_status: "done", claimed_at: null, claim_token: null, failure_reason: null })
    .eq("id", meeting.id)
    .eq("kind", "call")
    .eq("process_status", "processing")
    .eq("claim_token", claim)
    .select("id");
  if (error) throw new Error(`meetings: ${pgErrorText(error)}`);
  if (!data?.length) return { kind: "refused", httpStatus: 409, error: CLAIM_GONE };
  await logAgentRun(meeting.id, runKind, "ok", meeting.process_attempts, KEPT_TEXT);
  await logPipelineEvent(meeting.id, "info", "agent", KEPT_TEXT);
  return { kind: "kept" };
}

/**
 * Hands the call to a person: unsure (deleted after calls_decision_hours unless someone decides) or held. A client
 * or vendor label the routine gave on an earlier run is undone in the same transaction (hold_call), so the call is
 * undecided again: its turns back in the secret store, visible only to admins and the line's people.
 */
async function hold({ meeting, claim }: Claimed, kind: "unsure" | "held", text: string, confidence: number, reason?: HoldReason): Promise<Ended> {
  const { error } = await callsDb().rpc("hold_call", { p_meeting_id: meeting.id, p_claim: claim, p_kind: kind, p_reason: text, p_confidence: confidence });
  if (error) {
    const ended = endedByRefusal(error.message);
    if (ended) return ended;
    throw new Error(`hold_call: ${pgErrorText(error)}`);
  }
  await logPipelineEvent(meeting.id, "info", "agent", kind === "unsure" ? "Routine was not sure a call is a work call; a person decides" : `Routine's not-work answer was held for a person (${reason})`);
  if (reason === "budget") await budgetAlert(supabaseAdmin());
  return { kind: "held", hold: kind };
}

/** Deletes the call as not a work call, in the transaction that checks the claim, the label and the sheet. */
async function purge(claimed: Claimed, code: SkipCode, summary: string, runKind: "classify" | "skip"): Promise<Ended> {
  const result = await purgeCall(callsDb(), claimed.meeting.id, code, { by: "routine", summary, claim: claimed.claim });
  if (result.refused === "has_sheet") return keepSheet(claimed, runKind);
  if (result.refused) return endedByRefusal(result.refused) ?? { kind: "refused", httpStatus: 409, error: CLAIM_GONE };
  // Someone else deleted it first (a person's "Not a work call"): the routine's claim went with it.
  if (!result.purged) return { kind: "refused", httpStatus: 409, error: CALL_PURGED };
  await logPipelineEvent(claimed.meeting.id, "info", "agent", `Routine marked a call not a work call (${code})`);
  return { kind: "purged", code };
}

/** Rows per request when reading every client's name: the API answers at most 1000 rows a request. */
const CLIENT_PAGE = 1000;

/**
 * Every client's name, a page at a time until the count the first page reports: the holds must see them
 * all, not only the MAX_KNOWN_CLIENTS the routine's package lists.
 */
async function allClientNames(db: Db): Promise<string[]> {
  const names: string[] = [];
  let total = Infinity;
  while (names.length < total) {
    const { data, count, error } = await db.from("clients").select("name", { count: "exact" }).order("id").range(names.length, names.length + CLIENT_PAGE - 1);
    if (error) throw new Error(`clients: ${error.message}`);
    if (!data?.length) break;
    names.push(...data.map((c) => c.name));
    if (count !== null) total = count;
  }
  return names;
}

/** What the holds know about the other party: an earlier business call from this number, the saved name, every client's name. */
async function knownParty(db: Db, meetingId: string): Promise<KnownParty> {
  const [previouslyBusiness, ledger, clientNames] = await Promise.all([
    previousBusinessCall(db, meetingId),
    db.from("call_log").select("counterpart_name").eq("meeting_id", meetingId).maybeSingle(),
    allClientNames(db),
  ]);
  if (ledger.error) throw new Error(`call_log: ${ledger.error.message}`);
  return { previouslyBusiness, savedName: ledger.data?.counterpart_name ?? null, clientNames };
}

/** The routine's not-work answer: unsure (below the threshold), or sure, with what deleting the call needs. */
type NotWork = { sure: false; confidence: number } | { sure: true; confidence: number; code: SkipCode; summary: string; runKind: "classify" | "skip" };

/**
 * A not-work answer. Held for a person when the number or the saved name is known business, sure or not,
 * and when a sure answer finds the hour's purge budget used up. Otherwise an unsure answer waits for a
 * person (deleted after calls_decision_hours unless someone decides) and a sure one deletes the call.
 */
async function endNotWork(db: Db, claimed: Claimed, answer: NotWork, calls: CallsSettings): Promise<Ended> {
  const [party, purges] = await Promise.all([knownParty(db, claimed.meeting.id), answer.sure ? routinePurgesLastHour(db) : 0]);
  const reason = answer.sure ? holdReasonFor({ ...party, routinePurgesLastHour: purges, budgetPerHour: calls.routinePurgesPerHour }) : knownBusinessReason(party);
  if (reason) return hold(claimed, "held", heldText(reason), answer.confidence, reason);
  if (!answer.sure) return hold(claimed, "unsure", unsureText(answer.confidence, calls.decisionHours, new Date()), answer.confidence);
  return purge(claimed, answer.code, answer.summary, answer.runKind);
}

/** The routine says the call is a client or vendor call: it becomes team-readable and the routine writes the sheet. */
async function markBusiness(db: Db, { meeting, claim }: Claimed, c: CallClassification & { type: "client" | "vendor" }): Promise<ClassifyOutcome> {
  const guess = nameWithoutNumber(c.client_name_guess);
  let clientId = c.type === "client" ? meeting.client_id : null;
  if (c.type === "client" && !clientId && guess) {
    const { data: clients, error } = await db.from("clients").select("id, name");
    if (error) throw new Error(`clients: ${error.message}`);
    clientId = matchClientName(guess, clients ?? [])?.id ?? null;
  }
  const { error } = await callsDb().rpc("mark_call_business", {
    p_meeting_id: meeting.id,
    p_type: c.type,
    p_source: "llm",
    p_confidence: c.confidence,
    p_reason: redactPhones(c.reason),
    p_client_id: clientId as string,
    p_client_name_guess: guess as string,
    p_claim: claim,
  });
  if (error) {
    const ended = endedByRefusal(error.message);
    if (!ended) throw new Error(`mark_call_business: ${pgErrorText(error)}`);
    return classifyAnswer(ended, meeting, c);
  }
  const text = `Classified as a ${c.type} call (${percentOf(c.confidence)})`;
  await logAgentRun(meeting.id, "classify", "ok", meeting.process_attempts, text);
  await logPipelineEvent(meeting.id, "info", "classify", text);
  return { ok: true, proceed: true, status: "processing", type: c.type, confidence: c.confidence, errors: [] };
}

function classifyAnswer(ended: Ended, meeting: MeetingRow, c: CallClassification): ClassifyOutcome {
  switch (ended.kind) {
    case "purged":
      return { ok: true, proceed: false, status: "skipped", type: c.type, confidence: c.confidence, errors: [] };
    case "held":
      return { ok: true, proceed: false, status: "needs_decision", type: c.type, confidence: c.confidence, errors: [], held: ended.hold === "held" };
    case "kept":
      return { ok: true, proceed: false, status: "done", type: meeting.type, confidence: null, errors: [], kept: true };
    case "labelled":
      // A person said client or vendor while the routine was reading: their label stands; write the sheet.
      return { ok: true, proceed: true, status: "processing", type: meeting.type, confidence: 1, errors: [] };
    case "refused":
      return { ok: false, proceed: false, status: null, type: null, confidence: null, errors: [ended.error], httpStatus: ended.httpStatus };
  }
}

/**
 * POST /classify for a call. Client and vendor calls go on to the sheet whatever the confidence. Any other
 * answer is deleted only when the routine is sure (at or above classification.threshold) and nothing looks
 * risky; otherwise a person decides, without a time limit when the number or the saved name is known
 * business. A person's client or vendor label is final.
 */
export async function applyCallClassification(meetingId: string, json: unknown, claim: string | null): Promise<ClassifyOutcome> {
  const db = supabaseAdmin();
  const claimed = await claimedCall(db, meetingId, claim);
  if ("refused" in claimed) return { ok: false, proceed: false, status: null, type: null, confidence: null, errors: [claimed.refused.error], httpStatus: claimed.refused.httpStatus };
  const parsed = CallClassificationSchema.safeParse(json);
  if (!parsed.success) return { ok: false, proceed: false, status: null, type: null, confidence: null, errors: zodIssues(parsed.error) };
  const c = parsed.data;
  const { meeting } = claimed;

  if (meeting.type_source === "human" && isEligibleType("call", meeting.type)) {
    await logAgentRun(meeting.id, "classify", "ok", meeting.process_attempts, `Routine said ${c.type} (${percentOf(c.confidence)}); kept the person's label`);
    return { ok: true, proceed: true, status: "processing", type: meeting.type, confidence: 1, errors: [] };
  }

  const [settings, calls, sheets, salesGetSheets] = await Promise.all([readAgentSettings(), readCallsSettings(db), sheetCount(db, meeting.id), c.type === "sales" ? lineSalesGetSheets(db, meeting.id) : false]);
  const routing = routeCallClassification(c.type, c.confidence, settings.confidenceThreshold, salesGetSheets);
  if (routing.action === "proceed") return markBusiness(db, claimed, { ...c, type: routing.type });
  // Not a work call. A re-run's call that already has a sheet keeps it, sure or not.
  if (sheets > 0) return classifyAnswer(await keepSheet(claimed, "classify"), meeting, c);
  const answer: NotWork =
    routing.action === "hold"
      ? { sure: false, confidence: c.confidence }
      : { sure: true, confidence: c.confidence, code: routing.code, summary: `Classified as ${routing.code} (${percentOf(c.confidence)}) by the routine`, runKind: "classify" };
  return classifyAnswer(await endNotWork(db, claimed, answer, calls), meeting, c);
}

/**
 * POST /skip for a call: not a work call after all. Takes no reason (a fixed one is stored), never deletes a
 * call a person marked client or vendor (409) or a re-run's sheet, and goes through the same holds as classify.
 */
export async function skipCall(meetingId: string, code: SkipCode, claim: string | null): Promise<CallReleaseOutcome> {
  const db = supabaseAdmin();
  const claimed = await claimedCall(db, meetingId, claim);
  if ("refused" in claimed) return { ok: false, status: null, errors: [claimed.refused.error], httpStatus: claimed.refused.httpStatus };
  const { meeting } = claimed;
  if (code === "sales" && (await lineSalesGetSheets(db, meeting.id))) {
    await logPipelineEvent(meeting.id, "info", "agent", "Routine tried to skip a sales enquiry on a line whose enquiries get a sheet");
    return { ok: false, status: null, errors: [SALES_LINE_SKIP], httpStatus: 409 };
  }
  const ended: Ended = await (async () => {
    if (meeting.type_source === "human" && isEligibleType("call", meeting.type)) return { kind: "labelled" as const };
    const [calls, sheets] = await Promise.all([readCallsSettings(db), sheetCount(db, meeting.id)]);
    if (sheets > 0) return keepSheet(claimed, "skip");
    return endNotWork(db, claimed, { sure: true, confidence: 1, code, summary: `Skipped as ${code} by the routine`, runKind: "skip" }, calls);
  })();
  switch (ended.kind) {
    case "purged":
      return { ok: true, status: "skipped", errors: [] };
    case "held":
      return { ok: true, status: "needs_decision", errors: [], held: true };
    case "kept":
      return { ok: true, status: "done", errors: [], kept: true };
    case "labelled":
      await logPipelineEvent(meeting.id, "warn", "agent", "Routine tried to skip a call a person marked as business");
      return { ok: false, status: null, errors: [HUMAN_LABEL_SKIP], httpStatus: 409 };
    case "refused":
      return { ok: false, status: null, errors: [ended.error], httpStatus: ended.httpStatus };
  }
}

/**
 * POST /release for a call: back to the queue ('ready'), or 'failed' once the attempts are used up. Takes a
 * code, never free text; written only while the routine's claim is current (409 otherwise).
 */
export async function releaseCall(meetingId: string, code: ReleaseCode, claim: string | null): Promise<CallReleaseOutcome> {
  const db = supabaseAdmin();
  const [claimed, settings] = await Promise.all([claimedCall(db, meetingId, claim), readAgentSettings()]);
  if ("refused" in claimed) return { ok: false, status: null, errors: [claimed.refused.error], httpStatus: claimed.refused.httpStatus };
  const { meeting } = claimed;
  const attempts = meeting.process_attempts;
  const failed = attempts >= settings.maxAttempts;
  const text = RELEASE_TEXT[code];
  const { data, error } = await callsDb()
    .from("meetings")
    .update(
      failed
        ? { process_status: "failed", claimed_at: null, claim_token: null, failure_reason: `The routine gave up after ${attempts} attempts: ${text}` }
        : { process_status: "ready", claimed_at: null, claim_token: null },
    )
    .eq("id", meeting.id)
    .eq("kind", "call")
    .eq("process_status", "processing")
    .eq("claim_token", claimed.claim)
    .select("id");
  if (error) return { ok: false, status: null, errors: [pgErrorText(error)] };
  if (!data?.length) return { ok: false, status: null, errors: [CLAIM_GONE], httpStatus: 409 };
  await logAgentRun(meeting.id, failed ? "fail" : "release", "ok", attempts, text);
  await logPipelineEvent(meeting.id, failed ? "error" : "warn", "agent", failed ? `Routine gave up on a call after ${attempts} attempts (${code})` : `Routine released a call (${code})`);
  return { ok: true, status: failed ? "failed" : "ready", errors: [] };
}
