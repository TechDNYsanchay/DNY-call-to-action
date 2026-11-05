import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import type { ProcessStatus } from "@/lib/ui/status";
import { MeetingListRow } from "@/components/inbox/meeting-list-row";
import { ActionLane } from "@/components/meeting/action-lane";
import { ClassificationBanner } from "@/components/meeting/classification-banner";
import { EvidenceScope } from "@/components/meeting/evidence-toggle";
import { MetaLine, MinuteHeadline } from "@/components/meeting/minute-headline";
import { ProcessingTimeline } from "@/components/meeting/processing-timeline";
import { Scoreboard } from "@/components/meeting/scoreboard";
import { DecisionList, FactGrid, NextMeetingCard, QuestionList, RiskList, SentimentLine, SheetSection } from "@/components/meeting/sheet-sections";
import { Button, IconButton } from "@/components/ui/button";
import { Avatar, AvatarStack, Chip, CountTriple, Pill, PriorityDot, SectionLabel, StatusDot } from "@/components/ui/chip";
import { Field, Input, NativeSelect } from "@/components/ui/fields";
import { ListGroup } from "@/components/ui/page-header";
import { ActionRowSkeleton, RowSkeleton, SheetSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, InlineNote, QuietLine } from "@/components/ui/states";
import { attendees, clientItems, dnyItems, inboxRows, people, sampleClient, sampleMeeting, sheetView } from "./fixtures";

export const metadata: Metadata = { title: "Design review" };

const STATUSES: ProcessStatus[] = ["new", "waiting_transcript", "ready", "processing", "needs_decision", "done", "failed", "skipped"];

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="label-xs mb-3">{title}</h2>
      {children}
    </section>
  );
}

// Every main component in every state, in both themes side by side. Development only.
export default async function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  await requireUser();
  // The clock is request-time data; say so before reading it, or the prerender pass flags it.
  await connection();
  const today = new Date().toISOString();
  const laneProps = { people, contacts: attendees.filter((a) => a.side === "client"), tldvUrl: "https://app.tldv.io/meetings/sample", timestampParam: "t", today };
  const ctx = { tldvUrl: "https://app.tldv.io/meetings/sample", timestampParam: "t" };
  const done = sampleMeeting("done");

  const content = (
    <>
      <Block title="Marks">
        <div className="flex flex-wrap items-center gap-3">
          {(["ink", "bottle", "sienna", "signal", "slate", "muted", "pulse"] as const).map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
              <StatusDot tone={t} /> {t}
            </span>
          ))}
          <PriorityDot priority="high" />
          <PriorityDot priority="medium" />
          <PriorityDot priority="low" />
          <Chip>neutral</Chip>
          <Chip tone="bottle">Client meeting</Chip>
          <Chip tone="sienna">Sales 62%</Chip>
          <Chip tone="signal" mono>
            2 days overdue
          </Chip>
          <Chip tone="slate">question</Chip>
          <Chip tone="steel">ERP</Chip>
          <Pill tone="bottle">Priya</Pill>
          <Pill tone="sienna">Rakesh</Pill>
          <span className="dashed-chip inline-flex h-6 items-center rounded-full px-2 text-[12px]">Unassigned</span>
          <CountTriple dny={4} client={2} decisions={3} />
          <Avatar name="Priya Nair" />
          <AvatarStack people={attendees} max={3} />
        </div>
      </Block>

      <Block title="Buttons and fields">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button>
          <Button disabled>Disabled</Button>
          <IconButton label="Icon">
            <StatusDot tone="ink" />
          </IconButton>
        </div>
        <div className="mt-3 grid max-w-[520px] gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="d-name" hint="A hint under the field">
            <Input id="d-name" defaultValue="Saffron Court" />
          </Field>
          <Field label="Status" htmlFor="d-status" error="Pick one">
            <NativeSelect id="d-status" defaultValue="active">
              <option>active</option>
            </NativeSelect>
          </Field>
        </div>
      </Block>

      <Block title="Inbox rows">
        <ListGroup title="Every state" count={inboxRows.length}>
          {inboxRows.map((row) => (
            <MeetingListRow key={row.id} row={row} />
          ))}
        </ListGroup>
        <div className="card mt-3 divide-y divide-hairline">
          <RowSkeleton />
          <RowSkeleton />
        </div>
      </Block>

      <Block title="Sheet header and scoreboard">
        <div className="card p-5">
          <MinuteHeadline>{sheetView.headline}</MinuteHeadline>
          <MetaLine meeting={done} attendees={attendees} className="mt-3" />
          <Scoreboard dny={4} client={2} decisions={3} risks={1} className="mt-6" />
          <Scoreboard dny={0} client={2} decisions={1} risks={0} dnyComplete className="mt-4" />
          <MinuteHeadline provisional className="mt-6">
            Saffron Court | October review
          </MinuteHeadline>
        </div>
      </Block>

      <Block title="Action lanes (open, overdue, unassigned, check, review tray, done)">
        <div className="card p-5">
          <EvidenceScope>
            <div className="flex flex-col gap-8">
              <ActionLane lane="dny" title="DNY owes" items={dnyItems} emptyText="Nothing owed by DNY." {...laneProps} />
              <ActionLane lane="client" title="Client owes" items={clientItems} emptyText="Nothing owed by the client." {...laneProps} />
              <ActionLane lane="client" title="Client owes (empty)" items={[]} emptyText="Nothing owed by the client." {...laneProps} />
            </div>
          </EvidenceScope>
          <div className="mt-6 divide-y divide-hairline">
            <ActionRowSkeleton />
            <ActionRowSkeleton />
          </div>
        </div>
      </Block>

      <Block title="Sections">
        <div className="card flex flex-col gap-8 p-5" data-evidence="closed">
          <SheetSection id="d-decisions" title="Decisions" count={sheetView.decisions.length}>
            <DecisionList view={sheetView} ctx={ctx} />
          </SheetSection>
          <SheetSection id="d-facts" title="Facts & numbers" count={sheetView.key_facts.length}>
            <FactGrid view={sheetView} ctx={ctx} />
          </SheetSection>
          <SheetSection id="d-risks" title="Risks" count={sheetView.risks.length}>
            <RiskList view={sheetView} ctx={ctx} />
          </SheetSection>
          <SheetSection id="d-questions" title="Open questions" count={sheetView.open_questions.length}>
            <QuestionList view={sheetView} ctx={ctx} />
          </SheetSection>
          <SheetSection id="d-next" title="Next meeting">
            <NextMeetingCard view={sheetView} ctx={ctx} />
          </SheetSection>
          <SheetSection id="d-sentiment" title="Client sentiment">
            <SentimentLine view={sheetView} />
          </SheetSection>
          <SectionLabel count={0}>Empty section</SectionLabel>
          <QuietLine>Nothing owed by the client.</QuietLine>
        </div>
      </Block>

      <Block title="Processing timeline, every status">
        <div className="grid gap-4 md:grid-cols-2">
          {STATUSES.map((s) => (
            <div key={s} className="card p-4">
              <p className="mb-3 font-mono text-[12px] text-ink-3">{s}</p>
              <ProcessingTimeline meeting={sampleMeeting(s)} />
            </div>
          ))}
        </div>
      </Block>

      <Block title="Banners">
        <div className="flex flex-col gap-3">
          <ClassificationBanner meeting={sampleMeeting("needs_decision")} clients={[sampleClient]} external={["grandmeridian.in"]} isAdmin />
          <ClassificationBanner meeting={sampleMeeting("failed")} clients={[sampleClient]} external={[]} isAdmin />
          <ClassificationBanner meeting={sampleMeeting("skipped")} clients={[sampleClient]} external={["grandmeridian.in"]} isAdmin={false} />
          <InlineNote title="A plain note" tone="bottle">
            Inset background, 3 px bar, no fill.
          </InlineNote>
        </div>
      </Block>

      <Block title="States">
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState title="No client meetings yet." action={<Button>Do something</Button>}>
            Recordings from tl;dv appear here within a few minutes of a meeting ending.
          </EmptyState>
          <ErrorState title="This page could not be loaded" reason="Supabase returned 503 (service unavailable)" action={<Button>Try again</Button>} />
        </div>
        <div className="mt-4">
          <SheetSkeleton />
        </div>
      </Block>
    </>
  );

  return (
    <div className="-mx-4 -mt-4 md:-mx-6 md:-mt-6 lg:-mx-8">
      <div className="grid 2xl:grid-cols-2">
        <div data-theme="light" className="bg-canvas px-4 py-6 text-ink md:px-6">
          <p className="mb-6 font-mono text-[12px] text-ink-3">light</p>
          {content}
        </div>
        <div data-theme="dark" className="bg-canvas px-4 py-6 text-ink md:px-6">
          <p className="mb-6 font-mono text-[12px] text-ink-3">dark</p>
          {content}
        </div>
      </div>
    </div>
  );
}
