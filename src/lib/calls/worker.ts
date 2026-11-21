// The media workers: two run side by side in every calls run. Each leases the newest recording to copy
// (or, when there is none, the newest stored recording still waiting for its transcript), downloads it
// from Callyzer's media host, keeps it in the private bucket, creates the call, and has Deepgram
// transcribe it at once; the call is then 'ready' for the routine. Every step has a timeout and new work
// is only claimed in the first 52 s of a run, so the last item still finishes before the deadline.
// Housekeeping runs alongside: stale routine claims, links that never came, undecided calls past their
// time, and the storage deletion queue.

import { countSentences } from "@/lib/ingest/decisions";
import type { Json } from "@/lib/supabase/database.types";
import { wordCount } from "@/lib/tldv/turns";
import { END_RESERVE_MS, HOUSEKEEPING_BUDGET_MS, TIMEOUT_MS } from "./budget";
import { DeepgramError, DEEPGRAM_PROVIDER, transcribeWithDeepgram } from "./deepgram";
import type { CallsDeps, RunState, SttStop } from "./deps";
import { downloadRecording } from "./media";
import { drainStorageDeletions, RECORDINGS_BUCKET } from "./purge";
import { errorText, pgErrorText, sanitizeForLog } from "./sanitize";
import { speakerCountOf, wordsToCallTurns } from "./turns";

/** A copy or transcription lease older than this was left by a stopped run and is taken back. */
export const STALE_LEASE_MINUTES = 15;
/** Recordings with fewer words than this have no real conversation: purged as no_speech in the same transaction. */
export const MIN_WORDS = 8;
/** Deepgram fetches the recording at once; the link is good for 10 minutes. */
export const SIGNED_URL_SECONDS = 600;
/** A link that never comes: the ledger row expires this long after the call ended (or was first seen). */
export const LINK_EXPIRY_HOURS = 36;
/** Any undecided call is deleted after this many days, whatever its state. */
export const UNDECIDED_MAX_DAYS = 30;
/** Objects removed per run from the deletion queue (the nightly retention drains the rest). */
export const DRAIN_PER_RUN = 10;
/** One alert once this many copies in a row failed for a reason that will not pass by itself. */
export const COPY_ALERT_AFTER = 3;
/**
 * Counted attempts per call to copy, and to transcribe, before it fails: fixed, so at most 3 billed Deepgram
 * attempts per call, as in Sales QA. The routine's max_attempts setting only governs its claims on calls.
 */
export const MEDIA_MAX_ATTEMPTS = 3;

interface WorkItem {
  work: string;
  callyzer_id: string | null;
  meeting_id: string | null;
  recording_url: string | null;
  storage_path: string | null;
  duration_sec: number | null;
}

const COPY_ALERT_TEXT: Record<string, string> = {
  host: "host not allowed",
  http: "the recording host answers with an error",
  type: "the recording host sends something that is not audio",
  format: "the files are not a known audio format",
  redirect: "the recording links redirect elsewhere",
};

const STT_STOP_TEXT: Record<SttStop, string> = {
  auth: "Deepgram refused the API key; transcription is stopped until the key works again",
  credit: "Deepgram reports no credit left; transcription is stopped until the balance is topped up",
  cap: "Today's transcription limit is reached; recordings are still copied and are transcribed after midnight IST",
};

/** The HTTP status of a storage error, or null for a network failure or timeout. */
const storageStatus = (error: unknown): number | null => {
  const status = Number((error as { status?: unknown } | null)?.status);
  return Number.isFinite(status) && status > 0 ? status : null;
};

/** 4xx from storage will not pass by itself (content); 5xx, network and timeouts are transient. */
const storageOutcome = (error: unknown): "content" | "transient" => {
  const status = storageStatus(error);
  return status !== null && status >= 400 && status < 500 ? "content" : "transient";
};

/**
 * Removes objects at once and drops their queue rows; best effort, the drain retries whatever is left.
 * Skipped when it could run into the end reserve: the objects are already queued for the next run's drain.
 */
async function removeNow(deps: CallsDeps, run: RunState, paths: string[]): Promise<void> {
  if (run.elapsedMs() + TIMEOUT_MS.storageWrite + TIMEOUT_MS.db > run.deadlineMs - END_RESERVE_MS) return;
  const result = await deps.removeObjects(paths);
  if (result.ok) await deps.db.from("storage_deletions").delete().in("path", paths);
}

function stopTranscription(deps: CallsDeps, run: RunState, reason: SttStop): Promise<void> {
  run.sttStopped ??= reason;
  const first = run.prev.sttError !== reason && run.state.sttError !== reason;
  run.state.sttError = reason;
  run.state.sttErrorAt = deps.now().toISOString();
  // Logged once when it starts, not every 2 minutes while it lasts.
  return first ? deps.log(reason === "cap" ? "warn" : "error", "calls", STT_STOP_TEXT[reason]) : Promise.resolve();
}

function copySucceeded(run: RunState): void {
  run.state.copyError = null;
  run.state.copyFailuresInARow = 0;
  run.state.copyAlerted = false;
}

/** A copy that failed for a lasting reason: recorded with its kind (and only a disallowed host's name). */
async function copyFailed(deps: CallsDeps, run: RunState, kind: string, host?: string): Promise<void> {
  run.state.copyError = { kind, ...(kind === "host" && host ? { host } : {}), at: deps.now().toISOString() };
  run.state.copyFailuresInARow += 1;
  if (run.state.copyFailuresInARow >= COPY_ALERT_AFTER && !run.state.copyAlerted) {
    run.state.copyAlerted = true;
    await deps.log("error", "calls", `Recordings can't be copied: ${COPY_ALERT_TEXT[kind] ?? kind}${kind === "host" && host ? ` (${host})` : ""}`);
  }
}

async function finishCopy(deps: CallsDeps, callyzerId: string, outcome: "empty" | "transient" | "content" | "too_large", error?: string, errorKind?: string, bytes?: number): Promise<void> {
  const { error: rpcError } = await deps.db.rpc("finish_call_copy", {
    p_callyzer_id: callyzerId,
    p_outcome: outcome,
    ...(error ? { p_error: sanitizeForLog(error) } : {}),
    ...(errorKind ? { p_error_kind: errorKind } : {}),
    ...(bytes !== undefined ? { p_bytes: bytes } : {}),
    p_max_attempts: MEDIA_MAX_ATTEMPTS,
  });
  if (rpcError) throw new Error(`finish_call_copy failed: ${pgErrorText(rpcError)}`);
}

async function finishTranscription(deps: CallsDeps, meetingId: string, outcome: "not_billed" | "transient" | "content" | "final", error: string, errorKind: string): Promise<void> {
  const { error: rpcError } = await deps.db.rpc("finish_call_transcription", {
    p_meeting_id: meetingId,
    p_outcome: outcome,
    p_error: sanitizeForLog(error),
    p_error_kind: errorKind,
    p_max_attempts: MEDIA_MAX_ATTEMPTS,
  });
  if (rpcError) throw new Error(`finish_call_transcription failed: ${pgErrorText(rpcError)}`);
}

/** Sign -> Deepgram -> turns -> save_call_transcript. Expected failures are recorded here; anything else throws. */
async function transcribeItem(deps: CallsDeps, run: RunState, meetingId: string, path: string | null): Promise<void> {
  if (!path) throw new Error("the transcription lease has no stored recording");
  const signed = await deps.db.storage.from(RECORDINGS_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    run.counts.transcriptionFailures++;
    await finishTranscription(deps, meetingId, storageOutcome(signed.error), `signing the recording link failed: ${signed.error?.message ?? "no link"}`, "storage");
    return;
  }
  let result: Awaited<ReturnType<typeof transcribeWithDeepgram>>;
  try {
    result = await transcribeWithDeepgram(deps.fetch, deps.env.deepgramKey ?? "", signed.data.signedUrl, { mipOptOut: run.settings.mipOptOut });
  } catch (error) {
    if (!(error instanceof DeepgramError)) throw error;
    run.counts.transcriptionFailures++;
    // A refused key or credit stops transcription for the whole run at once, before the other worker claims again.
    const stopped = error.kind === "auth" || error.kind === "credit" ? stopTranscription(deps, run, error.kind) : null;
    await finishTranscription(deps, meetingId, error.outcome, error.message, error.kind);
    await (stopped ?? deps.log("warn", "calls", `Transcription failed (${error.kind}): ${error.message}`, meetingId));
    return;
  }
  const turns = wordsToCallTurns(result.words);
  const { data, error } = await deps.db.rpc("save_call_transcript", {
    p_meeting_id: meetingId,
    p_turns: turns as unknown as Json,
    p_sentences: countSentences(turns),
    p_words: wordCount(turns),
    p_speakers: speakerCountOf(turns),
    // Null when Deepgram gave no duration: the SQL falls back to the last word's end.
    p_audio_sec: result.durationSec as number,
    p_provider: DEEPGRAM_PROVIDER,
    p_min_words: MIN_WORDS,
  });
  if (error) throw new Error(`save_call_transcript failed: ${pgErrorText(error)}`);
  run.state.sttError = null;
  run.state.sttErrorAt = null;
  run.state.lastTranscribedAt = deps.now().toISOString();
  const saved = data?.[0];
  if (saved?.status === "ready") {
    run.counts.transcribed++;
    run.turnedReady++;
    if (run.turnedReady === 1) run.onFirstReady();
  } else if (saved?.status === "no_speech") {
    run.counts.noSpeech++;
    if (saved.purge_path) await removeNow(deps, run, [saved.purge_path]);
  }
}

/** Download -> (stub: empty) -> upload -> promote_call -> transcribe when the minutes allow. */
async function copyItem(deps: CallsDeps, run: RunState, item: WorkItem): Promise<void> {
  const id = item.callyzer_id;
  if (!id) throw new Error("the copy lease has no call id");
  // Set once promote_call has answered: from then on a failure belongs to the transcription.
  let meetingId: string | null = null;
  let promoted = false;
  try {
    if (!item.recording_url || !item.storage_path) throw new Error("the copy lease has no link or no path");
    const download = await downloadRecording(deps.fetch, item.recording_url, item.duration_sec ?? 0);
    if (download.kind === "empty") {
      await finishCopy(deps, id, "empty", undefined, undefined, download.bytes);
      run.counts.emptyRecordings++;
      copySucceeded(run);
      return;
    }
    if (download.kind === "error") {
      run.counts.copyFailures++;
      await finishCopy(deps, id, download.outcome, download.message, download.errorKind);
      if (download.outcome === "content") await copyFailed(deps, run, download.errorKind, download.host);
      await deps.log("warn", "calls", `A call recording could not be copied (${download.errorKind}): ${download.message}`);
      return;
    }
    const upload = await deps.db.storage
      .from(RECORDINGS_BUCKET)
      .upload(item.storage_path, download.bytes, { contentType: download.mime, upsert: true, cacheControl: "60" });
    if (upload.error) {
      run.counts.copyFailures++;
      await finishCopy(deps, id, storageOutcome(upload.error), `storing the recording failed: ${upload.error.message}`, "storage");
      await deps.log("warn", "calls", `A call recording could not be stored: ${sanitizeForLog(upload.error.message)}`);
      return;
    }
    const { data, error } = await deps.db.rpc("promote_call", {
      p_callyzer_id: id,
      p_recording_path: item.storage_path,
      p_mime: download.mime,
      p_bytes: download.bytes.byteLength,
      p_playable: download.playable,
      p_cap_minutes: run.settings.maxAudioMinutesPerDay,
      p_transcribe: !run.sttStopped && !run.settings.pipelinePaused,
    });
    if (error) throw new Error(`promote_call failed: ${pgErrorText(error)}`);
    promoted = true;
    meetingId = data?.[0]?.meeting_id ?? null;
    copySucceeded(run);
    const outcome = data?.[0]?.outcome;
    if (outcome === "dropped") {
      run.counts.dropped++;
      await removeNow(deps, run, [item.storage_path]);
      return;
    }
    run.counts.copied++;
    if (outcome === "transcribe" && meetingId) await transcribeItem(deps, run, meetingId, item.storage_path);
  } catch (error) {
    run.counts.errors++;
    const message = errorText(error);
    if (!promoted) await finishCopy(deps, id, "transient", message, "internal");
    else if (meetingId) await finishTranscription(deps, meetingId, "transient", message, "internal");
    await deps.log("error", "calls", `Copying or transcribing a call failed: ${message}`, meetingId);
  }
}

/** A transcription lease from claim_call_work: its own try/catch, like a copy. */
async function transcribeLease(deps: CallsDeps, run: RunState, item: WorkItem): Promise<void> {
  if (!item.meeting_id) return;
  try {
    await transcribeItem(deps, run, item.meeting_id, item.storage_path);
  } catch (error) {
    run.counts.errors++;
    const message = errorText(error);
    await finishTranscription(deps, item.meeting_id, "transient", message, "internal");
    await deps.log("error", "calls", `Transcribing a call failed: ${message}`, item.meeting_id);
  }
}

async function claimWork(deps: CallsDeps, run: RunState): Promise<WorkItem | null> {
  const { data, error } = await deps.db.rpc("claim_call_work", {
    p_stale_minutes: STALE_LEASE_MINUTES,
    p_max_attempts: MEDIA_MAX_ATTEMPTS,
    p_cap_minutes: run.settings.maxAudioMinutesPerDay,
    p_transcribe: !run.sttStopped && !run.settings.pipelinePaused,
  });
  if (error) throw new Error(`claim_call_work failed: ${pgErrorText(error)}`);
  return (data?.[0] as WorkItem | undefined) ?? null;
}

/**
 * One worker: claim, process, repeat, until the claim cutoff or nothing is left. When nothing is left
 * while the poll is still running, it waits for the poll once and tries again (the poll may add work).
 */
export async function runWorker(deps: CallsDeps, run: RunState, pollDone: Promise<unknown>): Promise<void> {
  let pollRunning = true;
  const pollSettled = pollDone.then(
    () => void (pollRunning = false),
    () => void (pollRunning = false),
  );
  let waitedForPoll = false;
  for (;;) {
    if (run.elapsedMs() > run.claimCutoffMs) return;
    let item: WorkItem | null;
    try {
      item = await claimWork(deps, run);
    } catch (error) {
      run.counts.errors++;
      await deps.log("error", "calls", errorText(error));
      return;
    }
    if (!item) {
      if (pollRunning && !waitedForPoll) {
        waitedForPoll = true;
        await pollSettled;
        continue;
      }
      return;
    }
    try {
      if (item.work === "cap") await stopTranscription(deps, run, "cap");
      else if (item.work === "copy") await copyItem(deps, run, item);
      else if (item.work === "transcribe") await transcribeLease(deps, run, item);
    } catch (error) {
      // Only the bookkeeping RPCs of a failure can land here; the lease is taken back after 15 minutes.
      run.counts.errors++;
      await deps.log("error", "calls", `A calls worker step failed: ${errorText(error)}`, item.meeting_id);
    }
  }
}

/**
 * Stale routine claims, expired links, undecided calls past their time, then 10 queued objects. Each step
 * has its own timeout (the calls client's); once 20 s have passed the remaining steps wait for the next
 * run. `privacyOnly` (calls paused or not configured) runs only the undecided expiry and the drain.
 */
export async function housekeeping(deps: CallsDeps, run: RunState, opts: { privacyOnly: boolean } = { privacyOnly: false }): Promise<void> {
  const s = run.settings;
  const started = deps.now().getTime();
  const steps: Array<[string, () => Promise<void>]> = [];
  if (!opts.privacyOnly) {
    steps.push([
      "releasing stale call claims",
      async () => {
        const { data, error } = await deps.db.rpc("release_stale_call_claims", { p_minutes: s.claimTimeoutMinutes, p_max_attempts: s.maxAttempts });
        if (error) throw new Error(pgErrorText(error));
        run.counts.claimsReleased += data ?? 0;
      },
    ]);
    steps.push([
      "expiring missing recording links",
      async () => {
        const { data, error } = await deps.db.rpc("expire_call_recordings", { p_hours: LINK_EXPIRY_HOURS });
        if (error) throw new Error(pgErrorText(error));
        run.counts.linksExpired += data ?? 0;
      },
    ]);
  }
  steps.push([
    "deleting undecided calls",
    async () => {
      const { data, error } = await deps.db.rpc("expire_undecided_calls", { p_decision_hours: s.decisionHours, p_failed_days: s.undecidedFailedDays, p_max_days: UNDECIDED_MAX_DAYS });
      if (error) throw new Error(pgErrorText(error));
      run.counts.undecidedDeleted += data ?? 0;
    },
  ]);
  steps.push([
    "removing deleted recordings",
    async () => {
      const drained = await drainStorageDeletions(deps.db, { limit: DRAIN_PER_RUN, remove: deps.removeObjects });
      run.counts.objectsRemoved += drained.removed;
      run.counts.objectRemovalsFailed += drained.failed;
    },
  ]);
  for (const [name, step] of steps) {
    if (deps.now().getTime() - started > HOUSEKEEPING_BUDGET_MS) {
      await deps.log("warn", "calls", `Housekeeping ran out of its ${HOUSEKEEPING_BUDGET_MS / 1000} s; ${name} waits for the next run`);
      return;
    }
    try {
      await step();
    } catch (error) {
      run.counts.errors++;
      await deps.log("error", "calls", `Housekeeping failed while ${name}: ${errorText(error)}`);
    }
  }
}
