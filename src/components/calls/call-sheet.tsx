import type { ActionItemRow, PersonSummary } from "@/lib/data/types";
import { quietSectionsLine } from "@/lib/ui/call-sheet";
import { isOpen, laneOf, openCounts, type OtherSide, otherOwesTitle } from "@/lib/ui/lanes";
import type { Attendee } from "@/lib/ui/participants";
import type { SheetView } from "@/lib/ui/sheet-result";
import { ActionLane } from "@/components/meeting/action-lane";
import { EvidenceScope } from "@/components/meeting/evidence-toggle";
import { Scoreboard } from "@/components/meeting/scoreboard";
import { DecisionList, type EvidenceContext, ExecutiveSummary, FactGrid, NextMeetingCard, QuestionList, RiskList, SentimentLine, SheetSection } from "@/components/meeting/sheet-sections";
import { QuietLine } from "@/components/ui/states";

// A call's sheet, built from the meeting sheet's pieces (the meeting page itself is untouched): the
// scoreboard, the two lanes ("Client owes · Cafe 89" or "Vendor owes · Sharma Traders"), one to three summary
// bullets, then only the sections a short call has something in, the empty ones said once in a quiet line,
// and the other side's sentiment last.

export interface CallSheetProps {
  view: SheetView;
  items: ActionItemRow[];
  otherSide: OtherSide;
  ctx: EvidenceContext;
  people: PersonSummary[];
  /** The other side as an owner choice: the contact saved on the phone. */
  contacts: Attendee[];
  me: { name: string; email: string };
  /** Today in ISO from the server, so relative dates match on both sides. */
  today: string;
}

export function CallSheet({ view, items, otherSide, ctx, people, contacts, me, today }: CallSheetProps) {
  const now = new Date(today);
  const counts = openCounts(items, now);
  const dnyItems = items.filter((i) => laneOf(i).includes("dny"));
  const otherItems = items.filter((i) => laneOf(i).includes("client"));
  const unclearItems = items.filter((i) => laneOf(i).includes("unclear"));
  const dnyComplete = dnyItems.length > 0 && dnyItems.every((i) => !isOpen(i));
  const laneProps = { people, contacts, tldvUrl: null, timestampParam: null, today, otherSide, seekable: ctx.seekable, speakerNames: ctx.speakerNames, me };
  const otherTitle = otherSide.name ? `${otherOwesTitle(otherSide)} · ${otherSide.name}` : otherOwesTitle(otherSide);
  const word = otherSide.word;
  const followUp = Boolean(view.next_meeting?.mentioned);

  const sections = [
    { key: "decisions", word: "decisions", has: view.decisions.length > 0 },
    { key: "facts", word: "facts", has: view.key_facts.length > 0 },
    { key: "risks", word: "risks", has: view.risks.length > 0 },
    { key: "questions", word: "open questions", has: view.open_questions.length > 0 },
    { key: "next", word: "follow-up", has: followUp },
  ];
  const quiet = quietSectionsLine(sections.filter((s) => !s.has).map((s) => s.word));

  return (
    <div className="fade-in">
      <Scoreboard dny={counts.dny} client={counts.client} decisions={view.decisions.length} risks={view.risks.length} dnyComplete={dnyComplete} otherSide={otherSide} />
      {dnyComplete && <p className="mt-2 text-[13px] text-ink-3">All DNY actions complete.</p>}
      {counts.overdue > 0 && <p className="mt-2 text-[13px] text-signal">{counts.overdue === 1 ? "1 item is overdue." : `${counts.overdue} items are overdue.`}</p>}

      <EvidenceScope className="mt-8">
        <div className="flex flex-col gap-8">
          <ActionLane lane="dny" title="DNY owes" items={dnyItems} emptyText="Nothing owed by DNY." {...laneProps} />
          <ActionLane lane="client" title={otherTitle} items={otherItems} emptyText={`Nothing owed by the ${word}.`} {...laneProps} />
          {unclearItems.length > 0 && <ActionLane lane="unclear" title="Owner unclear" items={unclearItems} emptyText="" {...laneProps} />}

          <SheetSection id="summary" title="Summary">
            <ExecutiveSummary bullets={view.executive_summary} />
          </SheetSection>
          {view.decisions.length > 0 && (
            <SheetSection id="decisions" title="Decisions" count={view.decisions.length}>
              <DecisionList view={view} ctx={ctx} />
            </SheetSection>
          )}
          {view.key_facts.length > 0 && (
            <SheetSection id="facts" title="Facts & numbers" count={view.key_facts.length}>
              <FactGrid view={view} ctx={ctx} />
            </SheetSection>
          )}
          {view.risks.length > 0 && (
            <SheetSection id="risks" title="Risks" count={view.risks.length}>
              <RiskList view={view} ctx={ctx} />
            </SheetSection>
          )}
          {view.open_questions.length > 0 && (
            <SheetSection id="questions" title="Open questions" count={view.open_questions.length}>
              <QuestionList view={view} ctx={ctx} />
            </SheetSection>
          )}
          {followUp && (
            <SheetSection id="next" title="Follow-up">
              <NextMeetingCard view={view} ctx={ctx} now={now} />
            </SheetSection>
          )}
          {quiet && <QuietLine className="-mt-4">{quiet}</QuietLine>}
          {view.client_sentiment && (
            <SheetSection id="sentiment" title={word === "vendor" ? "Vendor sentiment" : "Client sentiment"}>
              <SentimentLine view={view} />
            </SheetSection>
          )}
        </div>
      </EvidenceScope>
    </div>
  );
}
