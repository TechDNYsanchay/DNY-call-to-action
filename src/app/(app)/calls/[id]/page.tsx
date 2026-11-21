import { ArrowLeft, Lock } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getCallFeedStatus, getCallHeader, getCallPage } from "@/lib/data/calls";
import { formatDateTimeIst, formatTimestamp } from "@/lib/format";
import { recordingAvailability } from "@/lib/ui/audio-access";
import { refinedSeconds, sheetParticipants, speakerNamesOf, speakerSidesOf } from "@/lib/ui/call-sheet";
import { callFailureText, callStage, callTabTitle, callTimeline, callTypeChip, callWho, formatCallWhen } from "@/lib/ui/call-status";
import type { OtherSide } from "@/lib/ui/lanes";
import { lineWithPeople } from "@/lib/ui/line-name";
import type { Attendee } from "@/lib/ui/participants";
import { collectTicks, recordingLength, speakerOrder, speakerSpans } from "@/lib/ui/player";
import { readSheetResult } from "@/lib/ui/sheet-result";
import { type CallPermissions, RetryButton } from "@/components/calls/call-actions";
import { CallDecision } from "@/components/calls/call-decision";
import { CallHeader } from "@/components/calls/call-header";
import { CallRail } from "@/components/calls/call-rail";
import { CallSheet } from "@/components/calls/call-sheet";
import { CallTranscript } from "@/components/calls/call-transcript";
import { RecordingAvailability } from "@/components/calls/recording-availability";
import { RecordingPlayer } from "@/components/calls/recording-player";
import type { SpeakerTone } from "@/components/calls/scrubber";
import { SeekDelegate } from "@/components/calls/seek-delegate";
import { DetailsSheet } from "@/components/meeting/details-sheet";
import { LiveMeeting } from "@/components/meeting/live-meeting";
import { ProcessingTimeline } from "@/components/meeting/processing-timeline";
import type { EvidenceContext } from "@/components/meeting/sheet-sections";
import { RefreshOnFocus } from "@/components/shell/refresh-on-focus";
import { StatusDot } from "@/components/ui/chip";
import { ActionRowSkeleton, Skeleton } from "@/components/ui/skeleton";
import { InlineNote } from "@/components/ui/states";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const WITHHELD = "The recording and transcript open once the call is confirmed as a client or vendor call.";

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  await requireUser();
  const call = await getCallHeader(id).catch(() => null);
  if (!call || call.kind !== "call") return { title: "Call" };
  return { title: callTabTitle(callWho(call, call.call ?? { counterpart_name: null, counterpart_masked: "Call" }).text, call.happened_at) };
}

// One phone call: its header, the player, then the sheet (or where the call is in the pipeline, or the
// decision a person owes it), then the transcript on the same page. Every quote's time plays the recording
// from just before its words. The player lives in the layout, so none of this page's refreshes stop it.
export default async function CallPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const { person, isAdmin } = await requireUser();
  const [data, feed, query] = await Promise.all([getCallPage(id, { personId: person.id, isAdmin }), getCallFeedStatus(), searchParams]);
  if (!data) notFound();
  const { meeting, call, line, sheet, items, turns, settings, isBusiness, canSeeUndecided, isLineMember } = data;
  const today = new Date().toISOString();
  const now = new Date(today);
  const purged = Boolean(call.purged_at);

  const stage = callStage(meeting, call, {
    now,
    pipelinePaused: settings.pipelinePaused,
    claimTimeoutMin: settings.claimTimeoutMinutes,
    decisionHours: settings.decisionHours,
    undecidedFailedDays: settings.undecidedFailedDays,
    sttStop: feed?.sttError ?? null,
  });
  const availability = recordingAvailability({ purgedAt: call.purged_at, recordingStatus: call.recording_status, path: call.recording_path, type: meeting.type, playable: call.recording_playable, canSeeUndecided });
  const seekable = availability === "stored";
  const lineName = line?.name ?? "a removed line";
  const who = callWho(meeting, call);
  const view = sheet && isBusiness ? readSheetResult(sheet.result, sheet.headline) : null;
  const showSheet = Boolean(view) && ["done", "processing", "ready"].includes(meeting.process_status);
  const incoming = call.direction === "incoming";
  const headline = showSheet && view ? view.headline : (meeting.title ?? `${incoming ? "Incoming" : "Outgoing"} call on ${lineName}`);

  // The other side: in a vendor call's sheet the schema's "client" is the vendor.
  const otherSide: OtherSide = {
    word: meeting.type === "vendor" ? "vendor" : "client",
    name: (meeting.type === "client" ? (meeting.client?.name ?? call.counterpart_name) : (call.counterpart_name ?? meeting.client_name_guess)) ?? undefined,
  };
  const participants = sheet && isBusiness ? sheetParticipants(sheet.result) : [];
  const speakerNames = speakerNamesOf(participants, otherSide);
  const speakerSides = speakerSidesOf(participants);
  const refined = sheet && isBusiness ? refinedSeconds(sheet.result) : {};
  const turnList = turns ?? [];
  const lengthSec = recordingLength(meeting.duration_sec, call.recording_duration_sec, turnList);
  const speakerTones: SpeakerTone[] = speakerOrder(turnList).map((label, i) => (participants.length ? (speakerSides[label] ?? "b") : i % 2 ? "b" : "a"));
  const ticks = showSheet && view ? collectTicks(view, items, refined) : [];
  const ctx: EvidenceContext = { tldvUrl: null, timestampParam: null, otherSide, seekable, refined, speakerNames };
  const contacts: Attendee[] = isBusiness && call.counterpart_name ? [{ name: call.counterpart_name, email: null, side: "client", is_organizer: false }] : [];
  const deepLink = Number(Array.isArray(query.t) ? query.t[0] : query.t);
  const deepLinkSec = query.t !== undefined && Number.isFinite(deepLink) && deepLink >= 0 ? deepLink : null;
  const live = ["waiting_transcript", "ready", "processing", "needs_decision"].includes(meeting.process_status);
  // Deleted after 30 days and unplayable recordings keep a slim card that says so; withheld ones show nothing.
  const showPlayer = !purged && availability !== "withheld";

  const can: CallPermissions = {
    decide: !purged && !isBusiness && canSeeUndecided && meeting.process_status !== "needs_decision",
    notWork: !purged && (isAdmin || (isLineMember && !isBusiness)),
    switchTo: !purged && isBusiness ? (meeting.type === "client" ? "vendor" : "client") : null,
    retryTranscription: !purged && canSeeUndecided && call.stt_status === "failed" && !meeting.transcript_ready && call.recording_status === "stored",
    retryAnalysis: !purged && canSeeUndecided && meeting.process_status === "failed" && meeting.transcript_ready,
    rerun: !purged && isAdmin && isBusiness && meeting.process_status === "done" && meeting.transcript_ready,
  };

  const rail = (
    <CallRail
      meeting={meeting}
      call={call}
      line={line}
      sheet={sheet}
      versions={data.versions}
      runs={data.runs}
      clients={data.clients}
      isAdmin={isAdmin}
      isBusiness={isBusiness}
      availability={availability}
      lengthSec={lengthSec}
      retentionDays={settings.audioRetentionDays}
      can={can}
    />
  );

  const timeline = <ProcessingTimeline meeting={{ ...meeting, failure_reason: callFailureText(meeting.failure_reason) }} steps={callTimeline(meeting, call, stage.hint)} />;

  return (
    <div className="call-page mx-auto flex max-w-[1212px] gap-8">
      <LiveMeeting id={meeting.id} active={live} pollMs={60_000} />
      <RefreshOnFocus />
      <RecordingAvailability status={availability} skipCode={call.skip_code} title={headline} artist={line?.name ?? "Call recording"} lengthSec={lengthSec} />
      <SeekDelegate className="min-w-0 flex-1 xl:max-w-[880px]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Link href="/calls" className="inline-flex h-8 items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft size={14} aria-hidden="true" />
            Calls
          </Link>
          <div className="xl:hidden">
            <DetailsSheet>{rail}</DetailsSheet>
          </div>
        </div>

        {purged ? (
          <div className="card p-5 sm:p-6">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <StatusDot tone="muted" />
              {stage.word}
            </p>
            {stage.hint && <p className="mt-1 text-[14px] leading-[20px] text-ink-2">{stage.hint}</p>}
            <dl className="mt-4 grid grid-cols-[96px_1fr] gap-x-4 gap-y-1.5 text-[13px] leading-[18px]">
              <dt className="text-ink-3">Number</dt>
              <dd className="font-mono text-ink tnum">{call.counterpart_masked}</dd>
              <dt className="text-ink-3">Phone</dt>
              <dd className="text-ink">{line ? lineWithPeople(line, line.members) : "A removed line"}</dd>
              <dt className="text-ink-3">When</dt>
              <dd className="text-ink tnum">
                {formatCallWhen(meeting.happened_at, now)} · {incoming ? "Incoming" : "Outgoing"} · <span className="font-mono">{formatTimestamp(meeting.duration_sec)}</span>
              </dd>
              {call.purged_at && (
                <>
                  <dt className="text-ink-3">Deleted</dt>
                  <dd className="text-ink tnum">{formatDateTimeIst(call.purged_at)}</dd>
                </>
              )}
            </dl>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="card p-5 sm:p-6 xl:p-8">
              <CallHeader
                headline={headline}
                provisional={!showSheet}
                who={who}
                chip={callTypeChip(meeting.type)}
                stage={stage}
                when={formatCallWhen(meeting.happened_at, now)}
                durationSec={meeting.duration_sec}
                direction={call.direction}
                line={line ? lineWithPeople(line, line.members) : "A removed line"}
                callBack={data.callBack}
              />
            </div>

            {showPlayer && <RecordingPlayer availability={availability} lengthSec={lengthSec} spans={speakerSpans(turnList)} speakerTones={speakerTones} ticks={ticks} />}

            <div className="card p-5 sm:p-6 xl:p-8">
              {showSheet && view ? (
                <>
                  {meeting.process_status !== "done" && (
                    <p className="mb-2 rounded-card bg-inset px-3 py-2 text-[13px] leading-[18px] text-ink-2">
                      {meeting.process_status === "processing" ? "A new analysis run is working on this call. " : "Another analysis run is queued. "}
                      This sheet stays until the new version lands.
                    </p>
                  )}
                  <CallSheet view={view} items={items} otherSide={otherSide} ctx={ctx} people={data.people} contacts={contacts} me={{ name: person.full_name, email: person.email }} today={today} />
                </>
              ) : meeting.process_status === "needs_decision" ? (
                canSeeUndecided ? (
                  <CallDecision
                    callId={meeting.id}
                    hint={stage.hint}
                    clients={data.clients}
                    guess={meeting.type === "client" || meeting.type === "vendor" ? meeting.type : null}
                    defaultClientId={meeting.client_id}
                    canDelete={can.notWork}
                  />
                ) : (
                  <InlineNote title="Waiting for a decision" tone="sienna">
                    {/* Undecided (hold_call undoes a label the routine gave on an earlier run): withheld from members off its line. */}
                    {stage.hint} {isBusiness ? null : WITHHELD}
                  </InlineNote>
                )
              ) : meeting.process_status === "failed" ? (
                <div className="flex flex-col gap-6">
                  <InlineNote
                    title="This call could not be processed"
                    tone="signal"
                    actions={can.retryAnalysis ? <RetryButton callId={meeting.id} kind="analysis" /> : undefined}
                  >
                    {stage.hint}
                  </InlineNote>
                  {timeline}
                </div>
              ) : (
                <>
                  {timeline}
                  {!isBusiness && !canSeeUndecided && (
                    <p className="mt-6 flex items-start gap-2 rounded-card bg-inset px-3 py-2.5 text-[13px] leading-[18px] text-ink-2">
                      <Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-3" />
                      {WITHHELD}
                    </p>
                  )}
                  {/* The sheet's shape, so nothing jumps when it lands. */}
                  <div className="mt-10 border-t border-hairline pt-8" aria-hidden="true">
                    <div className="grid grid-cols-3 gap-4">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="flex flex-col gap-2">
                          <Skeleton className="h-8 w-10 xl:h-10" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      ))}
                    </div>
                    <Skeleton className="mt-10 h-3.5 w-24" />
                    <div className="mt-2 divide-y divide-hairline">
                      {[0, 1].map((i) => (
                        <ActionRowSkeleton key={i} />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {turns !== null &&
              (turnList.length > 0 ? (
                <CallTranscript turns={turnList} speakers={{ names: participants.length ? speakerNames : {}, sides: speakerSides }} seekable={seekable} deepLinkSec={deepLinkSec} />
              ) : call.stt_status === "failed" && !meeting.transcript_ready ? (
                <section className="card p-5 sm:p-6" aria-label="Transcript">
                  <InlineNote title="No transcript" tone="signal" actions={can.retryTranscription ? <RetryButton callId={meeting.id} kind="transcription" /> : undefined}>
                    {callFailureText(call.stt_error ?? meeting.failure_reason ?? "The transcription failed.")}
                  </InlineNote>
                </section>
              ) : meeting.process_status === "waiting_transcript" ? (
                <section className="card flex items-center gap-2.5 p-5 text-[14px] text-ink-2 sm:p-6" aria-label="Transcript">
                  <StatusDot tone="pulse" />
                  Transcribing… usually under a minute.
                </section>
              ) : null)}
          </div>
        )}
      </SeekDelegate>

      <aside className="sticky top-6 hidden h-fit w-[300px] shrink-0 xl:block" aria-label="Details">
        <div className="card p-4">{rail}</div>
      </aside>
    </div>
  );
}
