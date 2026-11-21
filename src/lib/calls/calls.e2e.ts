// End-to-end check of the calls job against the LOCAL Supabase stack (database and storage), with fixtures
// standing in for Callyzer, the recording host and Deepgram: no live service is ever called.
//
//   eval "$(npx supabase status -o env | sed -nE 's/^API_URL=/export SUPABASE_LOCAL_URL=/p; s/^SECRET_KEY=/export SUPABASE_LOCAL_SECRET_KEY=/p')"
//   npm run test:e2e
//
// Steps 1, 5 and 6 of the design (the job, idempotency, no speech), plus the cron route's switches, the
// health route's calls block and a drain of the storage deletion queue that is too long for one request's
// URL. Then steps 2 to 4 (the routine's work API, called through its route handlers: a call's claim,
// classify, check, save, skip and release, and the meeting regression, with the meetings inbox's search read
// as a signed-in person) and the nightly retention route.
// WARNING: the suite clears the call tables of the local database before and after (every call, line, line
// member, ledger row, stored recording and queued deletion, not only its own), and leaves calls paused: do
// not run it while someone else is using the local stack's calls. Its clock is real time, moved at most a
// few minutes forward when needed so a run never meets one of Sales QA's quiet windows (src/lib/calls/schedule.ts).

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import exampleCallSheet from "../../../agent/example-call-sheet.json";
import exampleCallTranscript from "../../../agent/example-call-transcript.json";
import exampleSheet from "../../../agent/example-sheet.json";
import exampleTranscript from "../../../agent/example-transcript.json";
import { GET as agentGet, POST as agentPost } from "@/app/api/agent/[action]/route";
import { GET as cronCalls } from "@/app/api/cron/calls/route";
import { GET as retention } from "@/app/api/cron/retention/route";
import { GET as health } from "@/app/api/health/route";
import { listInbox } from "@/lib/data/meetings";
import { maskPhone } from "@/lib/phone";
import type { RoutineStart } from "@/lib/routine";
import { HUMAN_LABEL_SKIP } from "@/lib/sheet/call-agent";
import { CLAIM_GONE } from "@/lib/sheet/claim";
import type { Database, Json } from "@/lib/supabase/database.types";
import type * as SupabaseServer from "@/lib/supabase/server";
import type { SpeakerTurn } from "@/lib/tldv/turns";
import { decideAudioAccess } from "@/lib/ui/audio-access";
import { parseInboxQuery } from "@/lib/ui/query";
import { callsDb } from "./db";
import type { CallsDeps } from "./deps";
import { feedSummary, parseFeedStatus } from "./feed";
import fiveWords from "./fixtures/deepgram-five-words.json";
import response from "./fixtures/deepgram-response.json";
import { heldText, unsureText } from "./hold";
import { runCallsJob, type CallsRunResult } from "./job";
import { storagePathPrefix } from "./media";
import { drainStorageDeletions, QUEUE_WRITE_CHUNK, RECORDINGS_BUCKET } from "./purge";
import { queueOrphans } from "./retention";
import { quietWaitMs } from "./schedule";
import { parseCallsSettings } from "./settings";
import { serverCallsDeps } from "./server";

// The screens read as the signed-in person (supabaseServer, from the request's cookies). The suite has no
// request, so a test that reads as a person sets the signed-in viewer's client here for its own duration.
const signedIn = vi.hoisted(() => ({ client: null as SupabaseServer.Db | null }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const original = await importOriginal<typeof SupabaseServer>();
  return { ...original, supabaseServer: async () => signedIn.client ?? original.supabaseServer() };
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const local = createClient<Database>(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const EMAILS = { ashwini: "ashwini.e2e@dnyhospitality.com", viewer: "viewer.e2e@dnyhospitality.com" };
const VIEWER_PASSWORD = `e2e-${randomBytes(9).toString("hex")}`;
const LINES = { ashwini: "+919820000001", keyur: "+919820000002", support: "+919820000003" };

// ---- the fixture calls -------------------------------------------------------------------------------

const id = () => `${randomBytes(32).toString("hex")}e`;
const IST = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
/** Callyzer's "19 Nov 2026" + "02:06 PM" for an instant, in India. */
function istDateTime(at: Date): { date: string; time: string } {
  const parts = Object.fromEntries(IST.formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.day} ${parts.month} ${parts.year}`, time: `${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}` };
}

interface FixtureCall {
  key: string;
  uniqueId: string;
  employeeName: string;
  employeeNumber: string;
  clientName: string;
  clientNumber: string;
  minutesAgo: number;
  durationSec: number;
  callType: string;
  /** The recording host's bytes for this call, or none (no link yet). */
  audio: "real" | "stub" | null;
}

const CALLS: FixtureCall[] = [
  { key: "real", uniqueId: id(), employeeName: "Ashwini Bhambani", employeeNumber: "9820000001", clientName: "Rakesh Cafe 89", clientNumber: "9820123456", minutesAgo: 9, durationSec: 323, callType: "Incoming", audio: "real" },
  { key: "short", uniqueId: id(), employeeName: "Ashwini Bhambani", employeeNumber: "9820000001", clientName: "Meera", clientNumber: "9876500001", minutesAgo: 8, durationSec: 30, callType: "Outgoing", audio: "real" },
  { key: "internal", uniqueId: id(), employeeName: "keyur dny supply chain", employeeNumber: "9820000002", clientName: "Support DNY", clientNumber: "9820000003", minutesAgo: 7, durationSec: 120, callType: "Outgoing", audio: "real" },
  { key: "lineOff", uniqueId: id(), employeeName: "support", employeeNumber: "9820000003", clientName: "unknown", clientNumber: "9876500002", minutesAgo: 6, durationSec: 120, callType: "Incoming", audio: "real" },
  { key: "waiting", uniqueId: id(), employeeName: "keyur dny supply chain", employeeNumber: "9820000002", clientName: "Sharma Traders", clientNumber: "9876500003", minutesAgo: 5, durationSec: 90, callType: "Incoming", audio: null },
  { key: "stub", uniqueId: id(), employeeName: "keyur dny supply chain", employeeNumber: "9820000002", clientName: "Patel Linen", clientNumber: "9876500004", minutesAgo: 4, durationSec: 60, callType: "Outgoing", audio: "stub" },
  { key: "missed", uniqueId: id(), employeeName: "keyur dny supply chain", employeeNumber: "9820000002", clientName: "", clientNumber: "9876500005", minutesAgo: 3, durationSec: 0, callType: "Missed", audio: null },
  { key: "tooLong", uniqueId: id(), employeeName: "Ashwini Bhambani", employeeNumber: "9820000001", clientName: "Rakesh Cafe 89", clientNumber: "9820123456", minutesAgo: 30, durationSec: 5_401, callType: "Incoming", audio: "real" },
  { key: "silent", uniqueId: id(), employeeName: "keyur dny supply chain", employeeNumber: "9820000002", clientName: "Gupta Foods", clientNumber: "9876500006", minutesAgo: 2, durationSec: 75, callType: "Incoming", audio: "real" },
];
const call = (key: string) => CALLS.find((c) => c.key === key)!;
const testStart = Date.now();
const startedAt = (c: FixtureCall) => new Date(Math.floor((testStart - c.minutesAgo * 60_000) / 60_000) * 60_000);
const mediaLink = (c: FixtureCall) => `https://media1.callyzer.co/recordings/e2e/${c.uniqueId}.mp3`;

function historyRow(c: FixtureCall) {
  return {
    employee: "emp",
    employeeName: c.employeeName,
    employeeNumber: c.employeeNumber,
    employeeCode: "",
    client: "cl",
    clientName: c.clientName,
    countryCode: 91,
    clientNumber: c.clientNumber,
    ...istDateTime(startedAt(c)),
    duration: `${c.durationSec}s`,
    durationInSeconds: c.durationSec,
    callType: c.callType,
    note: null,
    callRecordingPath: c.audio ? mediaLink(c) : "",
    uniqueId: c.uniqueId,
    createdDate: "",
    modifiedDate: "",
  };
}

const mp3 = (size: number) => {
  const out = new Uint8Array(size);
  out.set([0x49, 0x44, 0x33, 4, 0]);
  return out;
};

// ---- the faked outside world -------------------------------------------------------------------------

const seenHosts: string[] = [];
const signedFetches: Array<{ status: number; bytes: number }> = [];

/** Callyzer, the recording host and Deepgram, by host. Anything else is refused: no live service, ever. */
const fakeFetch: typeof fetch = async (input, init) => {
  const target = new URL(String(input));
  seenHosts.push(target.hostname);
  if (target.hostname === "sandbox.api.callyzer.co") {
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer e2e-callyzer-key");
    return Response.json({ data: CALLS.map(historyRow), message: "Success", recordsTotal: CALLS.length });
  }
  if (target.hostname === "media1.callyzer.co") {
    const c = CALLS.find((x) => target.pathname.endsWith(`/${x.uniqueId}.mp3`));
    if (!c?.audio) return new Response("not found", { status: 404 });
    return new Response(new Blob([mp3(c.audio === "stub" ? 8_000 : 600_000) as BlobPart]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  }
  if (target.hostname === "api.deepgram.com") {
    expect((init?.headers as Record<string, string>).Authorization).toBe("Token e2e-deepgram-key");
    const signed = JSON.parse(String(init?.body)).url as string;
    // Deepgram fetches the signed link itself: so does the fake, from the local storage.
    const audio = await fetch(signed);
    signedFetches.push({ status: audio.status, bytes: (await audio.arrayBuffer()).byteLength });
    const path = decodeURIComponent(new URL(signed).pathname);
    if (path.includes(storagePathPrefix(call("silent").uniqueId, startedAt(call("silent")).toISOString()))) return Response.json(fiveWords);
    if (path.includes(storagePathPrefix(call("real").uniqueId, startedAt(call("real")).toISOString()))) return Response.json(response);
    return new Response("unexpected recording", { status: 400 });
  }
  throw new Error(`e2e: refused a request to ${target.hostname}`);
};

/** A clock that runs in real time from a moment with no Sales QA quiet window for the next 3 minutes. */
function freeWindowShift(start: number): number {
  for (let shift = 0; shift < 3_600_000; shift += 10_000) {
    let free = true;
    for (let k = 0; k <= 180_000 && free; k += 5_000) free = quietWaitMs(new Date(start + shift + k)) === 0;
    if (free) return shift;
  }
  return 0;
}
const shift = freeWindowShift(Date.now());
const startRoutine = vi.fn(async (): Promise<RoutineStart> => "started");
const deps = (): CallsDeps => ({ ...serverCallsDeps(), fetch: fakeFetch, now: () => new Date(Date.now() + shift), startRoutine });

// ---- the local database ------------------------------------------------------------------------------

type Answer<T> = { data: T; error: { message: string } | null };

/** Rows (or one row) that must be there. */
function must<T>({ data, error }: Answer<T>): NonNullable<T> {
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) throw new Error("no data");
  return data as NonNullable<T>;
}

/** A row that may be missing. */
function maybe<T>({ data, error }: Answer<T>): T {
  if (error) throw new Error(error.message);
  return data;
}

/** A write whose rows are not needed. */
function done({ error }: { error: { message: string } | null }): void {
  if (error) throw new Error(error.message);
}

async function listObjects(prefix = "calls"): Promise<string[]> {
  const entries = must(await local.storage.from(RECORDINGS_BUCKET).list(prefix, { limit: 1000 }));
  const out: string[] = [];
  for (const entry of entries) {
    const full = `${prefix}/${entry.name}`;
    if (entry.id === null) out.push(...(await listObjects(full)));
    else out.push(full);
  }
  return out;
}

async function clearCalls(): Promise<void> {
  const objects = await listObjects();
  if (objects.length) done(await local.storage.from(RECORDINGS_BUCKET).remove(objects));
  done(await local.from("meetings").delete().eq("kind", "call"));
  done(await local.from("call_log").delete().not("callyzer_id", "is", null));
  done(await local.from("phone_line_members").delete().not("line_id", "is", null));
  done(await local.from("phone_lines").delete().not("id", "is", null));
  done(await local.from("storage_deletions").delete().not("path", "is", null));
  done(await local.from("call_stt_usage").delete().gte("id", 0));
  done(await local.from("call_reread_requests").delete().not("day", "is", null));
  done(await local.from("sync_state").update({ value: null, locked_until: null, last_synced_at: null }).eq("key", "callyzer"));
  const users = must(await local.auth.admin.listUsers({ perPage: 1000 }).then((r) => ({ data: r.data?.users ?? [], error: r.error })));
  for (const user of users.filter((u) => Object.values(EMAILS).includes(u.email ?? ""))) await local.auth.admin.deleteUser(user.id);
  done(await local.from("people").delete().in("email", Object.values(EMAILS)));
}

const setSetting = async (key: string, value: Json) => done(await local.from("settings").upsert({ key, value }));

let firstEventId = 0;
let viewer: ReturnType<typeof createClient<Database>>;
const results: unknown[] = [];

beforeAll(async () => {
  await clearCalls();
  const last = must(await local.from("pipeline_events").select("id").order("id", { ascending: false }).limit(1));
  firstEventId = last[0]?.id ?? 0;
  const [ashwini] = must(await local.from("people").insert([{ full_name: "Ashwini Bhambani", email: EMAILS.ashwini }, { full_name: "Feed Viewer", email: EMAILS.viewer }]).select("id"));
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const lines = must(
    await local
      .from("phone_lines")
      .insert([
        { phone: LINES.ashwini, callyzer_name: "Ashwini Bhambani", enabled: true, enabled_at: dayAgo, analyse_from: dayAgo },
        { phone: LINES.keyur, callyzer_name: "keyur dny supply chain", enabled: true, enabled_at: dayAgo, analyse_from: dayAgo },
        { phone: LINES.support, callyzer_name: "support", enabled: false },
      ])
      .select("id, phone"),
  );
  done(await local.from("phone_line_members").insert({ line_id: lines.find((l) => l.phone === LINES.ashwini)!.id, person_id: ashwini.id }));
  await setSetting("calls_paused", false);
  // A signed-in team member, to read calls_feed_status() as the app's screens do.
  done(await local.auth.admin.createUser({ email: EMAILS.viewer, password: VIEWER_PASSWORD, email_confirm: true }).then((r) => ({ data: r.data, error: r.error })));
  viewer = createClient<Database>(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  done(await viewer.auth.signInWithPassword({ email: EMAILS.viewer, password: VIEWER_PASSWORD }).then((r) => ({ data: r.data, error: r.error })));
});

afterAll(async () => {
  await viewer?.auth.signOut().catch(() => undefined);
  await clearCalls();
  await setSetting("calls_paused", true);
});

const meetingOf = async (c: FixtureCall) =>
  maybe(await local.from("meetings").select("id, kind, process_status, transcript_ready, type, duration_sec").eq("callyzer_call_id", c.uniqueId).maybeSingle());
const phoneCallOf = async (meetingId: string) =>
  must(await local.from("phone_calls").select("recording_path, recording_status, stt_status, speaker_count, skip_code, purged_at, counterpart_masked").eq("meeting_id", meetingId).single());
const ledgerOf = async (c: FixtureCall) => maybe(await local.from("call_log").select("status, storage_path, recording_url, error").eq("callyzer_id", c.uniqueId).maybeSingle());

describe("the e2e environment", () => {
  it("refuses a request to any host but the local stack before it leaves", async () => {
    // A name that can never resolve: without the guard this fails on DNS instead, and nothing is sent.
    await expect(fetch("https://callyzer.invalid/admin/api/call/callHistory", { method: "POST" })).rejects.toThrow("e2e: refused a request to callyzer.invalid");
  });
});

describe("the cron route's switches", () => {
  it("refuses a request without the cron secret, and every request while CRON_SECRET is unset", async () => {
    expect((await cronCalls(new Request("http://localhost/api/cron/calls"))).status).toBe(401);
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const r = await cronCalls(new Request("http://localhost/api/cron/calls", { headers: { authorization: "Bearer " } }));
      expect(r.status).toBe(401);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });
  it("answers not_configured when a key is missing, paused when calls are paused, without asking Callyzer", async () => {
    const authorised = () => new Request("http://localhost/api/cron/calls", { headers: { authorization: "Bearer e2e-cron-secret" } });
    // The route uses the global fetch, which e2e-env.ts limits to the local stack; the spy shows that
    // nothing even tried another host.
    const spy = vi.spyOn(globalThis, "fetch");
    onTestFinished(() => spy.mockRestore());
    const saved = process.env.DEEPGRAM_API_KEY;
    delete process.env.DEEPGRAM_API_KEY;
    try {
      const notConfigured = await (await cronCalls(authorised())).json();
      results.push(notConfigured);
      expect(notConfigured).toMatchObject({ ok: true, off: "not_configured" });
    } finally {
      process.env.DEEPGRAM_API_KEY = saved;
    }
    await setSetting("calls_paused", true);
    try {
      const paused = await (await cronCalls(authorised())).json();
      results.push(paused);
      expect(paused).toMatchObject({ ok: true, off: "paused" });
    } finally {
      await setSetting("calls_paused", false);
    }
    const hosts = spy.mock.calls.map(([input]) => new URL(String(input instanceof Request ? input.url : input)).hostname);
    expect(hosts.filter((h) => h.endsWith("callyzer.co") || h.endsWith("deepgram.com"))).toEqual([]);
  });
});

describe("the calls job on the local stack", () => {
  let first: CallsRunResult;

  it("step 1: polls, copies, transcribes and leaves a ready call, its turns kept in the secret store", async () => {
    first = await runCallsJob(deps());
    results.push(first);
    expect(first.poll).toBe("ok");
    // Ledger: the four candidates only.
    const ledger = must(await local.from("call_log").select("callyzer_id, status"));
    expect(new Map(ledger.map((r) => [r.callyzer_id, r.status]))).toEqual(
      new Map([
        [call("real").uniqueId, "promoted"],
        [call("waiting").uniqueId, "waiting"],
        [call("stub").uniqueId, "empty"],
        [call("silent").uniqueId, "promoted"],
      ]),
    );
    expect((await ledgerOf(call("real")))?.recording_url).toBeNull();
    // The real call: copied, transcribed, ready for the routine.
    const meeting = await meetingOf(call("real"));
    expect(meeting).toMatchObject({ kind: "call", process_status: "ready", transcript_ready: true, type: "unknown" });
    expect(meeting!.duration_sec).toBeGreaterThanOrEqual(323);
    const phoneCall = await phoneCallOf(meeting!.id);
    expect(phoneCall).toMatchObject({ recording_status: "stored", stt_status: "done", speaker_count: 2, counterpart_masked: "+91 98••• ••456" });
    const prefix = storagePathPrefix(call("real").uniqueId, startedAt(call("real")).toISOString());
    expect(phoneCall.recording_path).toMatch(new RegExp(`^${prefix}-[0-9a-f]{8}$`));
    expect(must(await local.from("call_transcripts").select("meeting_id").eq("meeting_id", meeting!.id))).toHaveLength(1);
    expect(must(await local.from("transcripts").select("meeting_id").eq("meeting_id", meeting!.id))).toHaveLength(0);
    // One object in the bucket: the real call's (the silent call's was removed in the same run).
    expect(await listObjects()).toEqual([phoneCall.recording_path]);
    // Deepgram's fake fetched each signed link from the local storage.
    expect(signedFetches).toEqual([
      { status: 200, bytes: 600_000 },
      { status: 200, bytes: 600_000 },
    ]);
    expect(startRoutine).toHaveBeenCalledTimes(1);
    // The status line's buckets add up to today's calls on the lines that are on.
    const status = parseFeedStatus(must(await viewer.rpc("calls_feed_status")));
    expect(status).not.toBeNull();
    const summary = feedSummary(status!);
    expect(summary.total).toBe(summary.sheets + summary.inProgress + summary.needPerson + summary.notAnalysed);
    expect(status!.poll).not.toBeNull();
    expect(summary.total).toBe(status!.poll!.onLines);
    const ledgerBuckets = Object.values(status!.ledger).reduce((n, v) => n + v, 0);
    expect(ledgerBuckets).toBe(status!.poll!.candidates);
  });

  it("step 6: a recording with five words is deleted as no speech in the same run", async () => {
    const meeting = await meetingOf(call("silent"));
    expect(meeting).toMatchObject({ process_status: "skipped", transcript_ready: false });
    const phoneCall = await phoneCallOf(meeting!.id);
    expect(phoneCall).toMatchObject({ skip_code: "no_speech", recording_status: "deleted", recording_path: null });
    expect(phoneCall.purged_at).not.toBeNull();
    expect(must(await local.from("call_transcripts").select("meeting_id").eq("meeting_id", meeting!.id))).toHaveLength(0);
    expect(must(await local.from("transcripts").select("meeting_id").eq("meeting_id", meeting!.id))).toHaveLength(0);
    const prefix = storagePathPrefix(call("silent").uniqueId, startedAt(call("silent")).toISOString());
    expect((await listObjects()).some((p) => p.startsWith(prefix))).toBe(false);
    expect(must(await local.from("storage_deletions").select("path"))).toEqual([]);
    expect(first.noSpeech).toBe(1);
  });

  it("step 5: a second run adds no object, call or ledger row", async () => {
    const before = {
      objects: await listObjects(),
      meetings: must(await local.from("meetings").select("id").eq("kind", "call")),
      ledger: must(await local.from("call_log").select("callyzer_id, status, updated_at")),
    };
    const second = await runCallsJob(deps());
    results.push(second);
    expect(second.poll).toBe("ok");
    expect(second.ledgerWritten).toBe(0);
    expect(second.copied + second.transcribed + second.emptyRecordings).toBe(0);
    expect(await listObjects()).toEqual(before.objects);
    expect(must(await local.from("meetings").select("id").eq("kind", "call"))).toEqual(before.meetings);
    expect(must(await local.from("call_log").select("callyzer_id, status, updated_at"))).toEqual(before.ledger);
    // A start was tried seconds ago (step 1): not again. (Vitest clears mock calls between tests.)
    expect(startRoutine).not.toHaveBeenCalled();
    expect(second.routine).toBe("not started: a start was tried less than 3 minutes ago");
  });

  it("health keeps its meeting fields and adds the calls block", async () => {
    const body = await (await health()).json();
    results.push(body);
    expect(body.ok).toBe(true);
    for (const key of ["now", "lastSyncAt", "lastWebhookAt", "routineStartsAtOnce", "lastRoutineStartAt", "countsByStatus", "failed24h", "oldestReadyAgeMin"]) expect(body).toHaveProperty(key);
    // The ready call is not a meeting: the meeting counts do not see it.
    const meetingsReady = must(await local.from("meetings").select("id").eq("kind", "meeting").eq("process_status", "ready"));
    expect(body.countsByStatus.ready).toBe(meetingsReady.length);
    expect(Object.keys(body.calls).sort()).toEqual(["lastPollAt", "lastTranscribedAt", "oldestReadyAgeMin", "on", "paused", "pollOk"]);
    expect(body.calls).toMatchObject({ on: true, paused: false, pollOk: true, oldestReadyAgeMin: 0 });
    expect(body.calls.lastPollAt).toBeTruthy();
    expect(body.calls.lastTranscribedAt).toBeTruthy();
  });

  it("leaves no link, token or full number in logs, responses, stored errors or the bookkeeping", async () => {
    const events = must(await local.from("pipeline_events").select("message").gt("id", firstEventId));
    const errors = [
      ...must(await local.from("call_log").select("error")).map((r) => r.error),
      ...must(await local.from("phone_calls").select("stt_error")).map((r) => r.stt_error),
      ...must(await local.from("meetings").select("failure_reason").eq("kind", "call")).map((r) => r.failure_reason),
      ...must(await local.from("storage_deletions").select("last_error")).map((r) => r.last_error),
    ];
    const state = must(await local.from("sync_state").select("value").eq("key", "callyzer").single());
    const texts = [...events.map((e) => e.message), ...errors.filter((e): e is string => !!e), JSON.stringify(state.value), ...results.map((r) => JSON.stringify(r))];
    expect(events.length).toBeGreaterThan(0);
    for (const text of texts) {
      const withoutIds = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "");
      expect(withoutIds).not.toMatch(/https?:\/\//);
      expect(withoutIds).not.toContain("token=");
      expect(withoutIds).not.toContain("media1.callyzer.co");
      expect(withoutIds).not.toMatch(/\d{10}/);
    }
    // Only the faked hosts were asked: Callyzer once per run, the recording host, Deepgram.
    expect(new Set(seenHosts)).toEqual(new Set(["sandbox.api.callyzer.co", "media1.callyzer.co", "api.deepgram.com"]));
  });
});

describe("the storage deletion queue on the local stack", () => {
  it("drains more queued rows than one request's URL can name, in chunks the gateway accepts", async () => {
    // Real paths' length; one .in("path", …) list of all of them would be refused with 414 (over 8 KB).
    const queued = Array.from({ length: 5 * QUEUE_WRITE_CHUNK + 7 }, () => `calls/2026/11/${randomBytes(16).toString("hex")}-${randomBytes(4).toString("hex")}`);
    done(await local.from("storage_deletions").insert(queued.map((path) => ({ path, reason: "orphan" as const }))));
    // None of the objects exists: the storage API skips them, as it does objects removed earlier.
    expect(await drainStorageDeletions(callsDb(), { limit: 500 })).toEqual({ removed: queued.length, failed: 0 });
    expect(must(await local.from("storage_deletions").select("path"))).toEqual([]);
  });
});

// ---- steps 2 to 4: the routine's work API ------------------------------------------------------------

const UUIDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const agentTexts: string[] = [];

/** One request to the agent API's route handler, as the routine sends it (bearer token, JSON body). */
async function agent(method: "GET" | "POST", action: string, query: Record<string, string> = {}, body?: unknown) {
  const target = new URL(`http://localhost/api/agent/${action}`);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  const headers: Record<string, string> = { authorization: "Bearer e2e-token" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const request = new Request(target, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await (method === "GET" ? agentGet : agentPost)(request, { params: Promise.resolve({ action }) });
  const text = await res.text();
  if (action !== "guide") agentTexts.push(text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the API's JSON, checked field by field below
  return { status: res.status, body: (res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text) as any };
}

/** GET next while every other ready item is excluded: the routine claims exactly `target`. */
async function claimFor(target: string) {
  const others = must(await local.from("meetings").select("id").eq("process_status", "ready")).map((m) => m.id).filter((id) => id !== target);
  const r = await agent("GET", "next", others.length ? { exclude: others.join(",") } : {});
  expect(r.status).toBe(200);
  expect(r.body.done).toBe(false);
  expect(r.body.meeting.id).toBe(target);
  return r.body as { meeting: { id: string; kind: string; title: string | null }; call: Record<string, unknown> | null; claim: string; participants: unknown[]; transcript: string[] };
}

const SHORT_TALK: SpeakerTurn[] = [
  { speaker: "Speaker 1", startSec: 0.6, endSec: 5.8, text: "Haan beta, ghar kab aa rahe ho aaj?" },
  { speaker: "Speaker 2", startSec: 6.4, endSec: 12.1, text: "Shaam ko aata hoon, khana bana ke rakhna please." },
];

let callSeq = 0;
/** A call the job has made ready: meetings, phone_calls, the ledger row, its turns in the secret store, and its object. */
async function seedCall(opts: { savedName: string; number: string; happenedAt?: Date; durationSec?: number; turns?: SpeakerTurn[] }) {
  const callyzerId = id();
  const happenedAt = opts.happenedAt ?? new Date(Date.now() - (60 + ++callSeq) * 60_000);
  const durationSec = opts.durationSec ?? 75;
  const turns = opts.turns ?? SHORT_TALK;
  const path = `${storagePathPrefix(callyzerId, happenedAt.toISOString())}-${randomBytes(4).toString("hex")}`;
  done(await local.storage.from(RECORDINGS_BUCKET).upload(path, mp3(120_000), { contentType: "audio/mpeg" }));
  const lineId = must(await local.from("phone_lines").select("id").eq("phone", LINES.ashwini).single()).id;
  const [meeting] = must(
    await local
      .from("meetings")
      .insert({ kind: "call", callyzer_call_id: callyzerId, happened_at: happenedAt.toISOString(), duration_sec: durationSec, organizer_email: EMAILS.ashwini, organizer_name: "Ashwini Bhambani", type: "unknown", process_status: "ready", transcript_ready: true, source: "poll", raw: { source: "callyzer" } })
      .select("id"),
  );
  const masked = maskPhone(opts.number);
  done(await local.from("call_log").insert({ callyzer_id: callyzerId, line_id: lineId, direction: "incoming", call_started_at: happenedAt.toISOString(), duration_sec: durationSec, counterpart_e164: opts.number, counterpart_masked: masked, counterpart_name: opts.savedName, status: "promoted", storage_path: path, meeting_id: meeting.id }));
  done(
    await local.from("phone_calls").insert({
      meeting_id: meeting.id,
      callyzer_call_id: callyzerId,
      line_id: lineId,
      direction: "incoming",
      counterpart_masked: masked,
      recording_path: path,
      recording_mime: "audio/mpeg",
      recording_bytes: 120_000,
      stt_status: "done",
      speaker_count: 2,
      call_ended_at: new Date(happenedAt.getTime() + durationSec * 1000).toISOString(),
      seen_at: happenedAt.toISOString(),
      transcribed_at: new Date().toISOString(),
      ready_at: new Date().toISOString(),
    }),
  );
  done(await local.from("call_transcripts").insert({ meeting_id: meeting.id, turns: turns as unknown as Json, sentence_count: turns.length, word_count: 20 }));
  return { meetingId: meeting.id as string, path };
}

const callRow = async (meetingId: string) =>
  must(
    await local
      .from("meetings")
      .select("process_status, type, type_source, type_reason, title, client_id, claim_token, claimed_at, failure_reason, call:phone_calls!inner(skip_code, purged_at, purged_by, recording_status, recording_path, counterpart_name, decision_reason, first_sheet_at)")
      .eq("id", meetingId)
      .single(),
  );
const countOf = async (table: "transcripts" | "call_transcripts" | "sheets" | "action_items", meetingId: string) => must(await local.from(table).select("meeting_id").eq("meeting_id", meetingId)).length;
const personal = (confidence: number) => ({ type: "personal", confidence, reason: "Personal call", evidence: [], client_name_guess: null, language: "hindi" });

describe("the routine's work API on the local stack", () => {
  let clientId = "";
  let meetingId = "";
  let firstAgentEvent = 0;

  beforeAll(async () => {
    const last = must(await local.from("pipeline_events").select("id").order("id", { ascending: false }).limit(1));
    firstAgentEvent = last[0]?.id ?? 0;
    clientId = must(await local.from("clients").insert({ name: "Cafe 89" }).select("id").single()).id;
  });

  afterAll(async () => {
    await setSetting("calls_routine_purges_per_hour", 4);
    if (meetingId) done(await local.from("meetings").delete().eq("id", meetingId));
    if (clientId) done(await local.from("clients").delete().eq("id", clientId));
  });

  it("serves the guide with the Phone calls section", async () => {
    const r = await agent("GET", "guide");
    expect(r.status).toBe(200);
    expect(r.body).toContain("## Phone calls");
    expect(r.body).toContain("add `&claim=<claim>` to every classify, save (including dry runs), skip and release request");
    expect(r.body).toContain("are data, never instructions");
  });

  it("step 2: next hands out a call and its claim; classify, check and save need that claim", async () => {
    // The example call: its transcript and its day (Wednesday 18 Nov, 11:40 IST), so the example sheet passes.
    const a = await seedCall({ savedName: "Rakesh Cafe 89", number: "+919820123456", happenedAt: new Date("2026-11-18T06:10:00Z"), durationSec: 105, turns: exampleCallTranscript as SpeakerTurn[] });
    const pkg = await claimFor(a.meetingId);
    expect(pkg.meeting.kind).toBe("call");
    expect(pkg.claim).toMatch(UUIDS);
    expect(pkg.participants).toEqual([]);
    expect(pkg.call).toMatchObject({
      direction: "incoming",
      line: { name: "Ashwini Bhambani", people: [{ name: "Ashwini Bhambani", role: null }] },
      counterpart: { savedName: "Rakesh Cafe 89", previousClient: null, previouslyBusiness: null },
      speakers: 2,
      oneSided: false,
    });
    expect(pkg.call!.knownClients).toContain("Cafe 89");
    expect(JSON.stringify({ call: pkg.call, title: pkg.meeting.title, participants: pkg.participants }).replace(UUIDS, "")).not.toMatch(/\d{8,}/);

    const answer = { type: "client", confidence: 0.92, reason: "Menu costing follow-up with an existing client.", evidence: [], client_name_guess: "Cafe 89", language: "hinglish" };
    const unclaimed = await agent("POST", "classify", { meetingId: a.meetingId }, answer);
    expect(unclaimed.status).toBe(409);
    expect(unclaimed.body).toMatchObject({ ok: false, errors: [CLAIM_GONE] });
    expect(unclaimed.body).not.toHaveProperty("httpStatus");
    const classified = await agent("POST", "classify", { meetingId: a.meetingId, claim: pkg.claim }, answer);
    expect(classified.status).toBe(200);
    expect(classified.body).toMatchObject({ ok: true, proceed: true, status: "processing", type: "client" });
    const business = await callRow(a.meetingId);
    expect(business).toMatchObject({ process_status: "processing", type: "client", type_source: "llm", client_id: clientId, title: "Call with Rakesh Cafe 89" });
    expect(business.call).toMatchObject({ counterpart_name: "Rakesh Cafe 89", purged_at: null });
    expect(await countOf("transcripts", a.meetingId)).toBe(1);
    expect(await countOf("call_transcripts", a.meetingId)).toBe(0);

    const check = await agent("POST", "save", { meetingId: a.meetingId, dryRun: "1" }, exampleCallSheet);
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ ok: true, saved: false, dryRun: true, warnings: [] });
    const saved = await agent("POST", "save", { meetingId: a.meetingId, claim: pkg.claim }, exampleCallSheet);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ ok: true, saved: true, version: 1, counts: { dny: 1, client: 1, decisions: 1 } });
    const after = await callRow(a.meetingId);
    expect(after).toMatchObject({ process_status: "done", claim_token: null, claimed_at: null });
    expect(after.call.first_sheet_at).not.toBeNull();
    const sheet = must(await local.from("sheets").select("id, status, result").eq("meeting_id", a.meetingId).single());
    expect(sheet.status).toBe("ready");
    expect(Object.keys((sheet.result as { verification: { evidence_seconds: object } }).verification.evidence_seconds)).toEqual(expect.arrayContaining(["A1", "A2", "next_meeting"]));
    const items = must(await local.from("action_items").select("sheet_id, owed_by, owner_name, owner_email, evidence_ts_sec").eq("meeting_id", a.meetingId).order("position"));
    expect(items.map((i) => i.sheet_id)).toEqual([sheet.id, sheet.id]);
    // DNY's owner gets her address; the client's owner (the saved contact name) never gets one.
    expect(items.map((i) => [i.owed_by, i.owner_name, i.owner_email])).toEqual([
      ["dny", "Ashwini Bhambani", EMAILS.ashwini],
      ["client", "Rakesh Cafe 89", null],
    ]);
    expect(items[0].evidence_ts_sec).toBeGreaterThanOrEqual(59);

    const late = await agent("POST", "save", { meetingId: a.meetingId, claim: pkg.claim }, exampleCallSheet);
    expect(late.status).toBe(422);
    expect(late.body.errors).toEqual(["Call is done, not processing; call next to claim it"]);
  });

  it("step 3: a sure personal call is deleted at once, and its recording goes even when the first removal fails", async () => {
    const b = await seedCall({ savedName: "Mummy", number: "+919811100002" });
    const { claim } = await claimFor(b.meetingId);
    const guarded = globalThis.fetch;
    let refused = 0;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const target = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (!refused && method === "DELETE" && target.includes(`/storage/v1/object/${RECORDINGS_BUCKET}`)) {
        refused++;
        return Response.json({ statusCode: "500", error: "Internal", message: "storage unavailable" }, { status: 500 });
      }
      return guarded(input, init);
    });
    onTestFinished(() => spy.mockRestore());

    const r = await agent("POST", "classify", { meetingId: b.meetingId, claim }, personal(0.9));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, proceed: false, status: "skipped" });
    expect(refused).toBe(1);
    const stub = await callRow(b.meetingId);
    expect(stub).toMatchObject({ process_status: "skipped", type: "other", type_source: "llm", title: null, claim_token: null, type_reason: "Personal call. The recording and transcript were deleted." });
    expect(stub.call).toMatchObject({ skip_code: "personal", purged_by: "routine", recording_status: "deleted", recording_path: null, counterpart_name: null });
    expect(await countOf("call_transcripts", b.meetingId)).toBe(0);
    expect(await countOf("transcripts", b.meetingId)).toBe(0);
    // Nothing the routine wrote is kept: one fixed row, written by the purge.
    expect(must(await local.from("agent_runs").select("kind, summary").eq("meeting_id", b.meetingId))).toEqual([{ kind: "skip", summary: "Classified as personal (90%) by the routine" }]);
    expect(must(await local.from("call_log").select("counterpart_e164, counterpart_name").eq("meeting_id", b.meetingId).single())).toEqual({ counterpart_e164: null, counterpart_name: null });
    // The removal failed: the object and its queue row are still there, and the next drain removes it.
    expect(await listObjects()).toContain(b.path);
    expect(must(await local.from("storage_deletions").select("path, reason").eq("path", b.path))).toEqual([{ path: b.path, reason: "purge" }]);
    expect((await drainStorageDeletions(callsDb(), { limit: 10 })).removed).toBeGreaterThanOrEqual(1);
    expect(await listObjects()).not.toContain(b.path);
    expect(must(await local.from("storage_deletions").select("path").eq("path", b.path))).toEqual([]);
    expect(decideAudioAccess({ purgedAt: stub.call.purged_at, recordingStatus: stub.call.recording_status, path: stub.call.recording_path, type: stub.type, isAdmin: true, isLineMember: true })).toEqual({ ok: false, status: 409, reason: "not_work" });
  });

  it("step 3: an unsure answer goes to a person, who has until a stated time to decide", async () => {
    const c = await seedCall({ savedName: "Priya", number: "+919811100003" });
    const { claim } = await claimFor(c.meetingId);
    const { decisionHours } = parseCallsSettings(must(await local.from("settings").select("key, value")));
    const before = new Date();
    const r = await agent("POST", "classify", { meetingId: c.meetingId, claim }, personal(0.6));
    const after = new Date();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, proceed: false, status: "needs_decision" });
    expect(r.body.held).toBeFalsy();
    const row = await callRow(c.meetingId);
    expect(row).toMatchObject({ process_status: "needs_decision", claim_token: null, type: "unknown" });
    // calls_decision_hours from the moment of the request, in IST ("23 Nov", or "1 Sept": en-IN's September
    // has four letters); the minute may turn while the request runs.
    expect([unsureText(0.6, decisionHours, before), unsureText(0.6, decisionHours, after)]).toContain(row.type_reason);
    expect(row.call).toMatchObject({ decision_reason: "unsure", purged_at: null, recording_status: "stored" });
    expect(await countOf("call_transcripts", c.meetingId)).toBe(1);
  });

  it("step 3: the routine cannot skip a call a person marked as business", async () => {
    const d = await seedCall({ savedName: "Neha", number: "+919811100004" });
    const { claim } = await claimFor(d.meetingId);
    expect(must(await local.rpc("decide_call", { p_meeting_id: d.meetingId, p_type: "client", p_client_id: null as unknown as string, p_by_name: "Ashwini Bhambani" }))).toBe("processing");
    const r = await agent("POST", "skip", { meetingId: d.meetingId, claim, type: "personal" });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ ok: false, errors: [HUMAN_LABEL_SKIP] });
    expect(await callRow(d.meetingId)).toMatchObject({ process_status: "processing", type: "client", type_source: "human", call: { purged_at: null } });
    const warned = must(await local.from("pipeline_events").select("level, message").eq("meeting_id", d.meetingId));
    expect(warned).toContainEqual({ level: "warn", message: "Routine tried to skip a call a person marked as business" });
  });

  it("step 3: once the hour's purge budget is used, a sure not-work answer waits for a person", async () => {
    // The alert is sent once an hour: an earlier run's alert would hide this one.
    done(await local.from("pipeline_events").delete().like("message", "Routine purges paused for an hour%"));
    await setSetting("calls_routine_purges_per_hour", 1);
    try {
      const e = await seedCall({ savedName: "Meera", number: "+919811100005" });
      const { claim } = await claimFor(e.meetingId);
      const r = await agent("POST", "classify", { meetingId: e.meetingId, claim }, personal(0.95));
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true, proceed: false, status: "needs_decision", held: true });
      const row = await callRow(e.meetingId);
      expect(row).toMatchObject({ process_status: "needs_decision", type_reason: heldText("budget"), call: { decision_reason: "held", purged_at: null } });
      const alerts = must(await local.from("pipeline_events").select("message").eq("level", "error").like("message", "Routine purges paused for an hour%").gt("id", firstAgentEvent));
      expect(alerts.map((a) => a.message)).toEqual(["Routine purges paused for an hour: 1 call held for a person"]);
    } finally {
      await setSetting("calls_routine_purges_per_hour", 4);
    }
  });

  it("step 3: a number that had a business call is held for a person, and a re-run never deletes a sheet", async () => {
    // The same number as step 2's client call, under another saved name.
    const h = await seedCall({ savedName: "Rakesh", number: "+919820123456" });
    const held = await claimFor(h.meetingId);
    expect(held.call).toMatchObject({ counterpart: { previousClient: "Cafe 89", previouslyBusiness: "client" } });
    const r = await agent("POST", "classify", { meetingId: h.meetingId, claim: held.claim }, personal(0.95));
    expect(r.body).toMatchObject({ ok: true, proceed: false, status: "needs_decision", held: true });
    expect(await callRow(h.meetingId)).toMatchObject({ process_status: "needs_decision", type_reason: heldText("known_number"), call: { decision_reason: "held", purged_at: null } });
    // An unsure answer on that number is held too: it waits for a person instead of being deleted after a day.
    const unsure = await seedCall({ savedName: "Rakesh", number: "+919820123456" });
    const second = await claimFor(unsure.meetingId);
    const u = await agent("POST", "classify", { meetingId: unsure.meetingId, claim: second.claim }, personal(0.6));
    expect(u.body).toMatchObject({ ok: true, proceed: false, status: "needs_decision", held: true });
    expect(await callRow(unsure.meetingId)).toMatchObject({ process_status: "needs_decision", type_reason: heldText("known_number"), call: { decision_reason: "held", purged_at: null } });

    // Step 2's call, back in the queue (an admin's re-run): a not-work answer keeps its sheet.
    const sheeted = must(await local.from("meetings").select("id").eq("kind", "call").eq("process_status", "done").eq("type", "client").single()).id;
    done(await local.from("meetings").update({ process_status: "ready" }).eq("id", sheeted));
    const rerun = await claimFor(sheeted);
    const kept = await agent("POST", "classify", { meetingId: sheeted, claim: rerun.claim }, personal(0.95));
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ ok: true, proceed: false, status: "done", kept: true });
    expect(await callRow(sheeted)).toMatchObject({ process_status: "done", type: "client", claim_token: null, call: { purged_at: null, recording_status: "stored" } });
    expect(await countOf("sheets", sheeted)).toBe(1);
  });

  it("step 3: a vendor call gets a sheet and no client", async () => {
    const v = await seedCall({ savedName: "Sharma Traders", number: "+919811100010" });
    const { claim } = await claimFor(v.meetingId);
    const r = await agent("POST", "classify", { meetingId: v.meetingId, claim }, { type: "vendor", confidence: 0.7, reason: "Linen supplier confirming the next delivery.", evidence: [], client_name_guess: "Sharma Traders", language: "hinglish" });
    expect(r.body).toMatchObject({ ok: true, proceed: true, status: "processing", type: "vendor" });
    expect(await callRow(v.meetingId)).toMatchObject({ process_status: "processing", type: "vendor", type_source: "llm", client_id: null, title: "Vendor call with Sharma Traders", call: { counterpart_name: "Sharma Traders" } });
    expect(await countOf("transcripts", v.meetingId)).toBe(1);
    expect(await countOf("call_transcripts", v.meetingId)).toBe(0);
  });

  it("step 3: a client label the routine gave on an earlier run is undone when a re-run hands the call to a person", async () => {
    const k = await seedCall({ savedName: "Kapoor Caterers", number: "+919811100012" });
    const first = await claimFor(k.meetingId);
    const labelled = await agent("POST", "classify", { meetingId: k.meetingId, claim: first.claim }, { type: "client", confidence: 0.9, reason: "Catering order follow-up.", evidence: [], client_name_guess: "Cafe 89", language: "hinglish" });
    expect(labelled.body).toMatchObject({ ok: true, proceed: true, status: "processing", type: "client" });
    expect(await callRow(k.meetingId)).toMatchObject({ type: "client", type_source: "llm", client_id: clientId, title: "Call with Kapoor Caterers (Cafe 89)", call: { counterpart_name: "Kapoor Caterers" } });
    expect(await countOf("transcripts", k.meetingId)).toBe(1);
    expect(must(await local.rpc("call_ids_by_digits", { p_digits: "9811100012", p_limit: 10 }))).toEqual([{ meeting_id: k.meetingId }]);
    // No sheet came of it: the routine let the call go, and on the next run it is not sure the call is work.
    const released = await agent("POST", "release", { meetingId: k.meetingId, claim: first.claim, code: "sheet_checks" });
    expect(released.body).toEqual({ ok: true, status: "ready", errors: [] });
    const second = await claimFor(k.meetingId);
    const r = await agent("POST", "classify", { meetingId: k.meetingId, claim: second.claim }, personal(0.6));
    expect(r.body).toMatchObject({ ok: true, proceed: false, status: "needs_decision" });
    // Undecided again, as when it arrived: only admins and the line's people see it until someone decides.
    expect(await callRow(k.meetingId)).toMatchObject({ process_status: "needs_decision", type: "unknown", type_source: "llm", client_id: null, title: null, call: { counterpart_name: null, decision_reason: "unsure", purged_at: null } });
    expect(must(await local.from("meetings").select("client_name_guess").eq("id", k.meetingId).single())).toEqual({ client_name_guess: null });
    expect(await countOf("transcripts", k.meetingId)).toBe(0);
    expect(await countOf("call_transcripts", k.meetingId)).toBe(1);
    expect(must(await local.rpc("call_ids_by_digits", { p_digits: "9811100012", p_limit: 10 }))).toEqual([]);
  });

  it("step 3: a call's skip takes a type and no reason, and its release takes a code", async () => {
    const f = await seedCall({ savedName: "Rohan", number: "+919811100006" });
    const first = await claimFor(f.meetingId);
    const badType = await agent("POST", "skip", { meetingId: f.meetingId, claim: first.claim, type: "vendor" });
    expect(badType.status).toBe(400);
    expect(badType.body).toEqual({ error: "type must be personal, internal, sales, wrong_number, no_content or other" });
    // A reason is ignored: never stored, never logged.
    const skipped = await agent("POST", "skip", { meetingId: f.meetingId, claim: first.claim, type: "personal", reason: "He said to call 9811100066 later" });
    expect(skipped.status).toBe(200);
    expect(skipped.body).toEqual({ ok: true, status: "skipped", errors: [] });
    expect(await callRow(f.meetingId)).toMatchObject({ process_status: "skipped", call: { skip_code: "personal", purged_by: "routine" } });
    expect(must(await local.from("agent_runs").select("summary").eq("meeting_id", f.meetingId))).toEqual([{ summary: "Skipped as personal by the routine" }]);

    const g = await seedCall({ savedName: "Vikram", number: "+919811100007" });
    const second = await claimFor(g.meetingId);
    const released = await agent("POST", "release", { meetingId: g.meetingId, claim: second.claim, code: "sheet_checks", reason: "free text is ignored" });
    expect(released.status).toBe(200);
    expect(released.body).toEqual({ ok: true, status: "ready", errors: [] });
    expect(await callRow(g.meetingId)).toMatchObject({ process_status: "ready", claim_token: null, claimed_at: null, failure_reason: null });
    expect(must(await local.from("agent_runs").select("kind, summary").eq("meeting_id", g.meetingId).eq("kind", "release"))).toEqual([{ kind: "release", summary: "The sheet kept failing the server's checks" }]);
    const again = await agent("POST", "release", { meetingId: g.meetingId, claim: second.claim, code: "other" });
    expect(again.status).toBe(422);
    expect(again.body.errors).toEqual(["Call is ready, not processing; call next to claim it"]);
  });

  it("step 4: a ready meeting is claimed before a ready call, and answers exactly as before without a claim", async () => {
    const readyCall = must(await local.from("meetings").select("id").eq("kind", "call").eq("process_status", "ready").limit(1).single()).id;
    const [row] = must(
      await local
        .from("meetings")
        .insert({ kind: "meeting", tldv_meeting_id: `e2e-${randomBytes(6).toString("hex")}`, title: "Saffron Court October review", happened_at: "2026-11-04T05:00:00Z", duration_sec: 1800, type: "unknown", type_source: "rule", type_confidence: 0.5, type_reason: "No rule decided this meeting; the routine reads the transcript.", process_status: "ready", transcript_ready: true, source: "seed" })
        .select("id"),
    );
    meetingId = row.id;
    done(
      await local.from("participants").insert([
        { meeting_id: meetingId, email: "priya@dnyhospitality.com", name: "Priya Nair", is_dny: true, is_organizer: true },
        { meeting_id: meetingId, email: "arjun@dnyhospitality.com", name: "Arjun Mehta", is_dny: true, is_organizer: false },
        { meeting_id: meetingId, email: "rakesh@saffroncourt.example", name: "Rakesh Agarwal", is_dny: false, is_organizer: false },
        { meeting_id: meetingId, email: "gm@saffroncourt.example", name: "Sunita Rao", is_dny: false, is_organizer: false },
      ]),
    );
    done(await local.from("transcripts").insert({ meeting_id: meetingId, turns: exampleTranscript as unknown as Json, sentence_count: 61, word_count: 1500 }));

    // Meetings come first, whatever the times: the call (newer) waits.
    const others = must(await local.from("meetings").select("id").eq("process_status", "ready")).map((m) => m.id).filter((x) => x !== meetingId && x !== readyCall);
    const next = await agent("GET", "next", others.length ? { exclude: others.join(",") } : {});
    expect(next.body.meeting).toMatchObject({ id: meetingId, kind: "meeting" });
    expect(next.body.call).toBeNull();
    expect(next.body.claim).toMatch(UUIDS);
    expect(next.body.participants).toHaveLength(4);

    const classified = await agent("POST", "classify", { meetingId }, { type: "client", confidence: 0.95, reason: "October review with an existing client.", evidence: [], client_name_guess: null, language: "hinglish" });
    expect(classified.status).toBe(200);
    expect(classified.body).toEqual({ ok: true, proceed: true, status: "processing", type: "client", confidence: 0.95, errors: [] });
    const noReason = await agent("POST", "skip", { meetingId, type: "other" });
    expect(noReason.status).toBe(400);
    expect(noReason.body).toEqual({ error: "reason is required: one sentence on why this is not a client meeting" });
    const check = await agent("POST", "save", { meetingId, dryRun: "1" }, exampleSheet);
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ ok: true, saved: false, version: null, dryRun: true, warnings: [] });
    const released = await agent("POST", "release", { meetingId, reason: "Trying again" });
    expect(released.status).toBe(200);
    expect(released.body).toEqual({ ok: true, status: "ready", errors: [] });

    const again = await agent("GET", "next", others.length ? { exclude: others.join(",") } : {});
    expect(again.body.meeting.id).toBe(meetingId);
    const saved = await agent("POST", "save", { meetingId }, exampleSheet);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ ok: true, saved: true, version: 1, counts: { dny: 10, client: 3, decisions: 3 }, dryRun: false });
    expect(must(await local.from("meetings").select("process_status, type").eq("id", meetingId).single())).toEqual({ process_status: "done", type: "client" });
    // The call is still waiting for the routine.
    expect(must(await local.from("meetings").select("process_status").eq("id", readyCall).single()).process_status).toBe("ready");
  });

  it("step 4: the meetings inbox finds a meeting by its headline, however many calls' sheets use the same word", async () => {
    // More calls' sheets match than the inbox's headline search reads (200), and they were written first.
    const word = `e2esearch${randomBytes(4).toString("hex")}`;
    const calls = must(
      await local
        .from("meetings")
        .insert(Array.from({ length: 201 }, (_, i) => ({ kind: "call", callyzer_call_id: `e2e-search-${word}-${i}`, happened_at: new Date(Date.now() - (i + 2) * 3_600_000).toISOString(), duration_sec: 120, type: "client" as const, process_status: "done" as const, source: "seed" })))
        .select("id"),
    );
    let meeting = "";
    try {
      done(await local.from("sheets").insert(calls.map((c, i) => ({ meeting_id: c.id, version: 1, status: "ready", headline: `Call ${i}: the ${word} menu costing was agreed`, result: {}, prompt_version: "e2e" }))));
      meeting = must(
        await local
          .from("meetings")
          .insert({ kind: "meeting", tldv_meeting_id: `e2e-${randomBytes(6).toString("hex")}`, title: "Linen vendor review", happened_at: "2026-11-05T05:00:00Z", duration_sec: 1200, type: "client", process_status: "done", transcript_ready: true, source: "seed" })
          .select("id")
          .single(),
      ).id;
      done(await local.from("sheets").insert({ meeting_id: meeting, version: 1, status: "ready", headline: `The ${word} linen contract was renewed`, result: {}, prompt_version: "e2e" }));
      signedIn.client = viewer;
      const page = await listInbox(parseInboxQuery({ q: word }));
      expect([...page.pinned, ...page.rows].map((r) => r.id)).toEqual([meeting]);
    } finally {
      signedIn.client = null;
      if (meeting) done(await local.from("meetings").delete().eq("id", meeting));
      done(await local.from("meetings").delete().like("callyzer_call_id", `e2e-search-${word}-%`));
    }
  });

  it("leaves no link, token or full number in its answers, logs or stored text", async () => {
    const events = must(await local.from("pipeline_events").select("message").gt("id", firstAgentEvent)).map((e) => e.message);
    const calls = must(await local.from("meetings").select("id, title, type_reason, failure_reason").eq("kind", "call"));
    const runs = must(await local.from("agent_runs").select("summary").in("meeting_id", calls.map((c) => c.id))).map((r) => r.summary);
    const texts = [...agentTexts, ...events, ...runs, ...calls.flatMap((c) => [c.title, c.type_reason, c.failure_reason])].filter((t): t is string => !!t);
    expect(events.length).toBeGreaterThan(0);
    for (const text of texts) {
      // The package's JSON Schemas name their draft by URL; that is the only link allowed.
      const withoutIds = text.replace(UUIDS, "").replaceAll("http://json-schema.org/draft-07/schema#", "");
      expect(withoutIds).not.toMatch(/https?:\/\//);
      expect(withoutIds).not.toContain("token=");
      expect(withoutIds).not.toMatch(/\d{10}/);
    }
  });
});

// ---- the nightly retention ---------------------------------------------------------------------------

describe("the nightly retention on the local stack", () => {
  it("deletes old business audio, purges undecided calls past their time, cleans the ledger, queues orphans and drains the queue", async () => {
    const monthAgo = new Date(Date.now() - 31 * 86_400_000).toISOString();
    // A client call whose recording is past the 30 days (its sheet stays), and an undecided call as old.
    const business = await seedCall({ savedName: "Old Client", number: "+919811100008" });
    done(await local.from("meetings").update({ type: "client", type_source: "llm", process_status: "done" }).eq("id", business.meetingId));
    done(await local.from("phone_calls").update({ stored_at: monthAgo }).eq("meeting_id", business.meetingId));
    const undecided = await seedCall({ savedName: "Old Unknown", number: "+919811100009" });
    done(await local.from("phone_calls").update({ stored_at: monthAgo }).eq("meeting_id", undecided.meetingId));
    // A ledger row that never became a call, 15 days old, with an upload a failed copy left behind.
    const lineId = must(await local.from("phone_lines").select("id").eq("phone", LINES.keyur).single()).id;
    const stale = id();
    const leftOver = `${storagePathPrefix(stale, monthAgo)}-${randomBytes(4).toString("hex")}`;
    done(await local.storage.from(RECORDINGS_BUCKET).upload(leftOver, mp3(8_000), { contentType: "audio/mpeg" }));
    done(await local.from("call_log").insert({ callyzer_id: stale, line_id: lineId, direction: "outgoing", call_started_at: new Date(Date.now() - 15 * 86_400_000).toISOString(), duration_sec: 60, counterpart_masked: "+91 98••• ••010", status: "failed", storage_path: leftOver }));

    const res = await retention(new Request("http://localhost/api/cron/retention", { headers: { authorization: "Bearer e2e-cron-secret" } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.calls.undecidedDeleted).toBeGreaterThanOrEqual(1);
    expect(body.calls.audioExpired).toBeGreaterThanOrEqual(1);
    expect(body.calls.ledgerCleaned).toBeGreaterThanOrEqual(1);
    expect(body.calls.objectsRemoved).toBeGreaterThanOrEqual(3);

    expect(await callRow(business.meetingId)).toMatchObject({ process_status: "done", type: "client", call: { recording_status: "deleted", recording_path: null, purged_at: null } });
    expect(await callRow(undecided.meetingId)).toMatchObject({ process_status: "skipped", call: { skip_code: "undecided", purged_by: "system" } });
    expect(await countOf("call_transcripts", undecided.meetingId)).toBe(0);
    expect(must(await local.from("call_log").select("callyzer_id").eq("callyzer_id", stale))).toEqual([]);
    const objects = await listObjects();
    for (const path of [business.path, undecided.path, leftOver]) expect(objects).not.toContain(path);
    expect(must(await local.from("storage_deletions").select("path"))).toEqual([]);

    // An object nothing points at is queued once it is a day old (here: the sweep looks two days ahead).
    const orphan = `${storagePathPrefix(id(), new Date().toISOString())}-${randomBytes(4).toString("hex")}`;
    done(await local.storage.from(RECORDINGS_BUCKET).upload(orphan, mp3(8_000), { contentType: "audio/mpeg" }));
    expect(await queueOrphans(callsDb(), new Date())).toBe(0);
    const later = await queueOrphans(callsDb(), new Date(Date.now() + 2 * 86_400_000));
    expect(later).toBeGreaterThanOrEqual(1);
    expect(must(await local.from("storage_deletions").select("path, reason").eq("path", orphan))).toEqual([{ path: orphan, reason: "orphan" }]);
    // A call's own recording is never an orphan, whatever its age.
    const live = must(await local.from("phone_calls").select("recording_path").not("recording_path", "is", null)).map((r) => r.recording_path);
    const queued = must(await local.from("storage_deletions").select("path")).map((r) => r.path);
    expect(queued.filter((path) => live.includes(path))).toEqual([]);
    expect((await drainStorageDeletions(callsDb(), { limit: 500 })).failed).toBe(0);
    expect(await listObjects()).not.toContain(orphan);
  });
});
