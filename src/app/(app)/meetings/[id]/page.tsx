import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { listClientOptions } from "@/lib/data/clients";
import { getMeetingHeader, getMeetingPage } from "@/lib/data/meetings";
import { listActivePeople } from "@/lib/data/people";
import { optionalEnv } from "@/lib/env";
import { parseSettings } from "@/lib/ingest/settings";
import { supabaseServer } from "@/lib/supabase/server";
import { isOpen, laneOf, openCounts } from "@/lib/ui/lanes";
import { attendeesOf, externalIdentities } from "@/lib/ui/participants";
import { readSheetResult } from "@/lib/ui/sheet-result";
import { ActionLane } from "@/components/meeting/action-lane";
import { ClassificationBanner } from "@/components/meeting/classification-banner";
import { ContextRailContent } from "@/components/meeting/context-rail";
import { DetailsSheet } from "@/components/meeting/details-sheet";
import { EvidenceScope } from "@/components/meeting/evidence-toggle";
import { LiveMeeting } from "@/components/meeting/live-meeting";
import { MetaLine, MinuteHeadline } from "@/components/meeting/minute-headline";
import { ProcessingTimeline } from "@/components/meeting/processing-timeline";
import { Scoreboard } from "@/components/meeting/scoreboard";
import { DecisionList, ExecutiveSummary, FactGrid, NextMeetingCard, purposeWord, QuestionList, RiskList, SentimentLine, SheetSection } from "@/components/meeting/sheet-sections";
import { ActionRowSkeleton, Skeleton } from "@/components/ui/skeleton";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  await requireUser();
  const meeting = await getMeetingHeader(id).catch(() => null);
  return { title: meeting?.client?.name ? `${meeting.client.name} · ${meeting.title ?? "Meeting"}` : meeting?.title ?? "Meeting" };
}

/** The confidence threshold is an admin-only setting; members fall back to the default. */
async function confidenceThreshold(): Promise<number> {
  const db = await supabaseServer();
  const { data } = await db.from("settings").select("key, value").eq("key", "confidence_threshold");
  return parseSettings(data ?? []).confidence_threshold;
}

// The sheet. While the meeting is still in the pipeline the same route renders the header from the
// tl;dv metadata and the processing timeline; a realtime subscription swaps the body in when done.
export default async function MeetingPage({ params }: { params: Params }) {
  const { id } = await params;
  const { isAdmin } = await requireUser();
  const [data, people, clients, threshold] = await Promise.all([getMeetingPage(id), listActivePeople(), listClientOptions(), confidenceThreshold()]);
  if (!data) notFound();
  const { meeting, participants, sheet, items } = data;
  const timestampParam = optionalEnv("TLDV_TIMESTAMP_PARAM") ?? null;
  const attendees = attendeesOf(participants, meeting.type);
  const external = externalIdentities(participants);
  const contacts = attendees.filter((a) => a.side !== "dny");
  const today = new Date().toISOString();
  const now = new Date(today);

  const showSheet = Boolean(sheet) && (meeting.process_status === "done" || meeting.process_status === "processing" || meeting.process_status === "ready");
  const live = ["new", "waiting_transcript", "ready", "processing"].includes(meeting.process_status);
  const view = sheet ? readSheetResult(sheet.result, sheet.headline) : null;
  const counts = openCounts(items, now);
  const dnyItems = items.filter((i) => laneOf(i).includes("dny"));
  const clientItems = items.filter((i) => laneOf(i).includes("client"));
  const unclearItems = items.filter((i) => laneOf(i).includes("unclear"));
  const dnyComplete = dnyItems.length > 0 && dnyItems.every((i) => !isOpen(i));
  const ctx = { tldvUrl: meeting.tldv_url, timestampParam };
  const rail = <ContextRailContent data={data} attendees={attendees} clients={clients} external={external} isAdmin={isAdmin} timestampParam={timestampParam} />;
  const laneProps = { people, contacts, tldvUrl: meeting.tldv_url, timestampParam, today };

  return (
    <div className="mx-auto flex max-w-[1212px] gap-8">
      <LiveMeeting id={meeting.id} active={live} />
      <article className="min-w-0 flex-1 xl:max-w-[880px]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Link href="/meetings" className="inline-flex h-8 items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft size={14} aria-hidden="true" />
            Meetings
          </Link>
          <div className="xl:hidden">
            <DetailsSheet>{rail}</DetailsSheet>
          </div>
        </div>

        <div className="mb-4 empty:hidden">
          <ClassificationBanner meeting={meeting} clients={clients} external={external} isAdmin={isAdmin} />
        </div>

        <div className="card p-5 sm:p-6 xl:p-8">
          <header>
            <MinuteHeadline provisional={!showSheet}>{showSheet && view ? view.headline : meeting.title ?? "Untitled meeting"}</MinuteHeadline>
            <MetaLine meeting={meeting} attendees={attendees} threshold={threshold} className="mt-3" />
            {showSheet && view?.quality && (view.quality.transcript_quality !== "good" || !view.quality.speaker_labels_reliable) && (
              <p className="mt-2 text-[12px] text-ink-3">
                Transcript quality {view.quality.transcript_quality}
                {!view.quality.speaker_labels_reliable && " · speaker names were unreliable, so owners may be missing"}
              </p>
            )}
          </header>

          {showSheet && meeting.process_status !== "done" && (
            <p className="mt-4 rounded-card bg-inset px-3 py-2 text-[13px] leading-[18px] text-ink-2">
              {meeting.process_status === "processing" ? "A new analysis run is working on this meeting. " : "Another analysis run is queued (about hourly). "}
              This sheet stays until the new version lands.
            </p>
          )}

          {showSheet && view ? (
            <div className="fade-in">
              <Scoreboard dny={counts.dny} client={counts.client} decisions={view.decisions.length} risks={view.risks.length} dnyComplete={dnyComplete} className="mt-6" />
              {dnyComplete && <p className="mt-2 text-[13px] text-ink-3">All DNY actions complete.</p>}
              {counts.overdue > 0 && <p className="mt-2 text-[13px] text-signal">{counts.overdue === 1 ? "1 item is overdue." : `${counts.overdue} items are overdue.`}</p>}

              <EvidenceScope className="mt-8">
                <div className="flex flex-col gap-8">
                  <ActionLane lane="dny" title="DNY owes" items={dnyItems} emptyText="Nothing owed by DNY." {...laneProps} />
                  <ActionLane lane="client" title="Client owes" items={clientItems} emptyText="Nothing owed by the client." {...laneProps} />
                  {unclearItems.length > 0 && <ActionLane lane="unclear" title="Owner unclear" items={unclearItems} emptyText="" {...laneProps} />}

                  <SheetSection id="summary" title="Summary">
                    <ExecutiveSummary bullets={view.executive_summary} />
                    {view.meeting_purpose && <p className="mt-2 text-[12px] text-ink-3">Purpose: {purposeWord(view.meeting_purpose)}</p>}
                  </SheetSection>
                  <SheetSection id="decisions" title="Decisions" count={view.decisions.length}>
                    <DecisionList view={view} ctx={ctx} />
                  </SheetSection>
                  <SheetSection id="facts" title="Facts & numbers" count={view.key_facts.length}>
                    <FactGrid view={view} ctx={ctx} />
                  </SheetSection>
                  <SheetSection id="risks" title="Risks" count={view.risks.length}>
                    <RiskList view={view} ctx={ctx} />
                  </SheetSection>
                  <SheetSection id="questions" title="Open questions" count={view.open_questions.length}>
                    <QuestionList view={view} ctx={ctx} />
                  </SheetSection>
                  <SheetSection id="next" title="Next meeting">
                    <NextMeetingCard view={view} ctx={ctx} now={now} />
                  </SheetSection>
                  {view.client_sentiment && (
                    <SheetSection id="sentiment" title="Client sentiment">
                      <SentimentLine view={view} />
                    </SheetSection>
                  )}
                </div>
              </EvidenceScope>
            </div>
          ) : (
            <div className="mt-8">
              {meeting.process_status === "skipped" ? (
                <p className="text-[14px] leading-[20px] text-ink-3">No sheet is written for {meeting.type === "sales" ? "sales" : meeting.type === "internal" ? "internal" : "non-client"} meetings.</p>
              ) : (
                <>
                  <ProcessingTimeline meeting={meeting} />
                  {/* The body's shape, so nothing jumps when the sheet lands. */}
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
                      {[0, 1, 2].map((i) => (
                        <ActionRowSkeleton key={i} />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </article>

      <aside className="sticky top-6 hidden h-fit w-[300px] shrink-0 xl:block" aria-label="Details">
        <div className="card p-4">{rail}</div>
      </aside>
    </div>
  );
}
