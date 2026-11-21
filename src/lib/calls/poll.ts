// One Callyzer poll per run: today's calls (today-2..today every 10 minutes, for links that arrive late),
// plus up to two days an admin asked to re-read. The DNY lines seen are registered, the rules decide which
// rows are candidate calls (src/lib/calls/rules.ts), and only those reach the secret ledger (call_log);
// every other row is only counted for the status line. Nothing but counts and error kinds leaves this
// file: no number, contact name or link is ever logged.

import { CallyzerError, type CallyzerErrorKind, createPacer, fetchCallHistory, PollStop } from "@/lib/callyzer/client";
import { type CallyzerRow, parseCallHistoryRow } from "@/lib/callyzer/parse";
import { istDate } from "@/lib/format";
import { toE164Strict } from "@/lib/phone";
import type { Json } from "@/lib/supabase/database.types";
import type { CallsDeps, RunState } from "./deps";
import { batchLinesOf, classifyCallRows, soleMatchingPerson, todayStats } from "./rules";
import { pgErrorText } from "./sanitize";
import { pollDue, pollWindows, REREAD_MAX_DAYS, REREADS_PER_RUN, ymdMinus } from "./schedule";
import type { ClassifiedRow } from "./types";

/** Configuration errors, and an empty answer for today, hold polling for 15 minutes. */
export const POLL_HOLD_MS = 15 * 60_000;
const HOLD_KINDS: ReadonlySet<CallyzerErrorKind> = new Set<CallyzerErrorKind>(["host", "auth", "add_on", "bad_request", "empty"]);
/** One alert once this many runs in a row failed with the same kind; none again until a poll succeeds. */
export const POLL_ALERT_AFTER = 3;
const LEDGER_CHUNK = 200;

export const POLL_ALERT_TEXT: Record<CallyzerErrorKind, string> = {
  host: "Callyzer: CALLYZER_API_BASE is not an allowed Callyzer host, so no calls are read",
  auth: "Callyzer: the API key was refused (401), so no calls are read. Copy the current pair from Sales QA (scripts/copy-shared-keys.sh); never press Generate API Access Key",
  add_on: "Callyzer: the API add-on or subscription has expired (403), so no calls are read",
  bad_request: "Callyzer: the call-history request was rejected (400), so no calls are read",
  rate: "Callyzer: rate limited (429) on 3 runs in a row; check Sales QA's Callyzer schedule",
  network: "Callyzer: the API did not answer on 3 runs in a row",
  empty: "Callyzer: the API returned nothing for today on 3 runs in a row; the sandbox host may have stopped serving current data",
  bad_response: "Callyzer: the API answered with something that is not the call history on 3 runs in a row",
};

export interface PollResult {
  /** Today's window was read and stored. */
  ok: boolean;
  /** Why this run did not read today's window without an error. */
  skipped?: "hold" | "night" | "quiet" | "budget";
  error?: CallyzerErrorKind | "database";
}

/** A database step of the ingest failed; the poll then stores nothing more and reports "database". */
class IngestError extends Error {}

/** One registration per line and name, with the latest call: register_phone_lines picks the newest named row. */
function lineRegistrations(rows: CallyzerRow[]): Array<{ phone: string; name: string | null; last_call_at: string }> {
  const byKey = new Map<string, { phone: string; name: string | null; last_call_at: string }>();
  for (const row of rows) {
    const phone = toE164Strict("91", row.employeeNumber);
    if (!phone) continue;
    const key = `${phone}\u0000${row.employeeName ?? ""}`;
    const seen = byKey.get(key);
    if (!seen || Date.parse(row.startedAt) > Date.parse(seen.last_call_at)) byKey.set(key, { phone, name: row.employeeName, last_call_at: row.startedAt });
  }
  return [...byKey.values()];
}

/** A line switched on at first sight gets its user as its member, when exactly one active person matches its name. */
async function assignSolePeople(deps: CallsDeps, lines: Array<{ line_id: string; callyzer_name: string }>): Promise<void> {
  const { data: people, error } = await deps.db.from("people").select("id, full_name, email, active").eq("active", true);
  if (error) {
    await deps.log("warn", "calls", `Reading people for new lines failed: ${pgErrorText(error)}`);
    return;
  }
  const members = lines.flatMap((line) => {
    const person = soleMatchingPerson(line.callyzer_name, people ?? []);
    return person ? [{ line_id: line.line_id, person_id: person.id }] : [];
  });
  if (!members.length) return;
  const { error: insertError } = await deps.db.from("phone_line_members").upsert(members, { onConflict: "line_id,person_id", ignoreDuplicates: true });
  if (insertError) await deps.log("warn", "calls", `Setting the person of a new line failed: ${pgErrorText(insertError)}`);
}

/** Register lines -> read every line (with its number) -> decide each row -> write the candidates to the ledger. */
async function ingest(deps: CallsDeps, run: RunState, rows: CallyzerRow[]): Promise<ClassifiedRow[]> {
  const registrations = lineRegistrations(rows);
  if (registrations.length) {
    const { data, error } = await deps.db.rpc("register_phone_lines", { p_lines: registrations as unknown as Json });
    if (error) throw new IngestError(`Registering phone lines failed: ${pgErrorText(error)}`);
    const created = (data ?? []).filter((line) => line.created);
    run.counts.linesCreated += created.length;
    const switchedOn = created.filter((line) => line.enabled);
    if (switchedOn.length) await assignSolePeople(deps, switchedOn);
    for (const line of created) {
      await deps.log("info", "calls", `New phone line in Callyzer: ${line.callyzer_name} (${line.enabled ? "switched on: it is one of the initial client lines" : "off until an admin switches it on"})`);
    }
  }
  const { data: lines, error } = await deps.db.from("phone_lines").select("id, phone, enabled, analyse_from");
  if (error) throw new IngestError(`Reading phone lines failed: ${pgErrorText(error)}`);
  const results = classifyCallRows(rows, {
    lines: new Map((lines ?? []).map((l) => [l.phone, { id: l.id, enabled: l.enabled, analyseFrom: l.analyse_from }])),
    dnyNumbers: new Set(run.settings.dnyNumbers),
    batchLines: batchLinesOf(rows),
    minDurationSec: run.settings.minDurationSec,
    maxDurationSec: run.settings.maxMinutes * 60,
  });
  const ledger = results.flatMap((r) => (r.ledger ? [r.ledger] : []));
  run.counts.candidates += ledger.length;
  for (let i = 0; i < ledger.length; i += LEDGER_CHUNK) {
    const { data, error: upsertError } = await deps.db.rpc("upsert_call_log", { p_rows: ledger.slice(i, i + LEDGER_CHUNK) as unknown as Json });
    if (upsertError) throw new IngestError(`Storing polled calls failed: ${pgErrorText(upsertError)}`);
    run.counts.ledgerWritten += data?.length ?? 0;
  }
  return results;
}

/** Days an admin asked to re-read (call_reread_requests), oldest request first, within the last 14 days. */
async function pendingRereads(deps: CallsDeps, now: Date): Promise<string[]> {
  const today = istDate(now);
  const { data, error } = await deps.db
    .from("call_reread_requests")
    .select("day")
    .is("done_at", null)
    .gte("day", ymdMinus(today, REREAD_MAX_DAYS))
    .lte("day", today)
    .order("requested_at", { ascending: true })
    .limit(REREADS_PER_RUN);
  if (error) {
    await deps.log("warn", "calls", `Reading re-read requests failed: ${pgErrorText(error)}`);
    return [];
  }
  return (data ?? []).map((r) => r.day);
}

/** A failed poll: its kind, a 15-minute hold for configuration errors, one warning per streak, one alert at 3. */
async function noteFailure(deps: CallsDeps, run: RunState, error: CallyzerError, now: Date): Promise<void> {
  const failures = (run.prev.pollError === error.kind ? run.prev.pollFailures : 0) + 1;
  run.state.pollError = error.kind;
  run.state.pollErrorAt = now.toISOString();
  run.state.pollFailures = failures;
  if (HOLD_KINDS.has(error.kind)) run.state.pollHoldUntil = new Date(now.getTime() + POLL_HOLD_MS).toISOString();
  if (failures === 1) await deps.log("warn", "callyzer", `Callyzer poll failed (${error.kind}): ${error.message}`);
  if (failures >= POLL_ALERT_AFTER && !run.prev.pollAlerted) {
    await deps.log("error", "callyzer", POLL_ALERT_TEXT[error.kind]);
    run.state.pollAlerted = true;
  }
}

/**
 * The run's poll. Skipped while a hold is on, between night polls, or when Sales QA's quiet window would
 * delay it too long. Errors are recorded in the run's bookkeeping, never thrown; only an unexpected
 * exception rejects, and the job's other parts finish regardless.
 */
export async function pollAndIngest(deps: CallsDeps, run: RunState): Promise<PollResult> {
  const now = deps.now();
  const holdUntil = Date.parse(run.prev.pollHoldUntil ?? "");
  if (Number.isFinite(holdUntil) && holdUntil > now.getTime()) return { ok: false, skipped: "hold" };
  if (!pollDue(now, run.settings.nightPollMinutes)) return { ok: false, skipped: "night" };

  const windows = pollWindows(now, run.prev.lastWideReadAt, await pendingRereads(deps, now));
  const pacer = createPacer(deps, run.startedAt);
  const cfg = { base: deps.env.callyzerBase ?? "", key: deps.env.callyzerKey ?? "" };
  const rows: CallyzerRow[] = [];
  const rereadsDone: string[] = [];
  let todayRead = false;
  let stop: PollStop | null = null;
  let failure: CallyzerError | null = null;
  for (const w of windows) {
    try {
      const raw = await fetchCallHistory(deps, cfg, w, pacer, run);
      run.counts.rowsFetched += raw.length;
      for (const item of raw) {
        const parsed = parseCallHistoryRow(item);
        if ("row" in parsed) rows.push(parsed.row);
        else run.counts.badRows++;
      }
      if (w.rereadDay) rereadsDone.push(w.rereadDay);
      else todayRead = true;
    } catch (error) {
      if (error instanceof PollStop) {
        stop = error;
        break;
      }
      if (!(error instanceof CallyzerError)) throw error;
      // A re-read day Callyzer will not serve is closed with a warning, rather than holding the poll or
      // being asked for again every run.
      if (w.rereadDay && (error.kind === "empty" || error.kind === "bad_request")) {
        rereadsDone.push(w.rereadDay);
        await deps.log("warn", "callyzer", `Re-reading ${w.rereadDay} from Callyzer failed (${error.kind}); the request was closed`);
        continue;
      }
      failure = error;
      break;
    }
  }

  if (!todayRead) {
    if (failure) {
      await noteFailure(deps, run, failure, now);
      return { ok: false, error: failure.kind };
    }
    return { ok: false, skipped: stop?.reason ?? "quiet" };
  }
  const today = istDate(now);
  if (run.counts.badRows && run.prev.badRowsWarnedOn !== today) {
    run.state.badRowsWarnedOn = today;
    await deps.log("warn", "callyzer", `${run.counts.badRows} call-history rows from Callyzer could not be read and were skipped (warned once a day)`);
  }

  let results: ClassifiedRow[];
  try {
    results = rows.length ? await ingest(deps, run, rows) : [];
  } catch (error) {
    if (!(error instanceof IngestError)) throw error;
    run.counts.errors++;
    await deps.log("error", "calls", error.message);
    return { ok: false, error: "database" };
  }
  if (rereadsDone.length) {
    const { error } = await deps.db.from("call_reread_requests").update({ done_at: deps.now().toISOString() }).in("day", rereadsDone);
    if (error) await deps.log("warn", "calls", `Closing re-read requests failed: ${pgErrorText(error)}`);
  }

  const okAt = deps.now().toISOString();
  const stats = todayStats(results, today);
  Object.assign(run.state, { lastPollOkAt: okAt, pollHoldUntil: null, pollError: null, pollErrorAt: null, pollFailures: 0, pollAlerted: false, today: stats, lines: stats.lines });
  if (windows[0].from !== windows[0].to) run.state.lastWideReadAt = okAt;
  run.pollOk = true;
  return { ok: true };
}
