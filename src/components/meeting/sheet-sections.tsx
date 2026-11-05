import clsx from "clsx";
import { CalendarBlank, Question } from "@phosphor-icons/react/dist/ssr";
import type { Evidence } from "@/lib/sheet/schema";
import { formatShortDate, relativeDue, secondsFrom } from "@/lib/format";
import { recordingUrl } from "@/lib/ui/evidence";
import { evidenceVerified, PURPOSE_WORDS, SENTIMENT_WORDS, type SheetView } from "@/lib/ui/sheet-result";
import { Chip, SectionLabel } from "@/components/ui/chip";
import { QuietLine } from "@/components/ui/states";
import { EvidencePill } from "./evidence";
import { EvidenceQuote } from "./evidence-quote";

// The sections below the lanes, in fixed order: decisions, facts, risks, open questions, next
// meeting, client sentiment. Server components; only the evidence pill is interactive.

export interface EvidenceContext {
  tldvUrl: string | null;
  timestampParam: string | null;
}

/** Pill + hidden inline quote for one entry's first quote. */
function EntryEvidence({ evidence, id, view, ctx }: { evidence: Evidence[]; id: string; view: SheetView; ctx: EvidenceContext }) {
  const first = evidence[0];
  if (!first) return null;
  const seconds = secondsFrom(first.timestamp);
  const verified = evidenceVerified(view, id);
  return (
    <>
      <EvidencePill seconds={seconds} speaker={first.speaker} quote={first.quote} quoteEnglish={first.quote_english} recordingHref={recordingUrl(ctx.tldvUrl, seconds, ctx.timestampParam)} verified={verified} more={evidence.length - 1} />
      <div className="evidence-inline basis-full pt-1">
        <EvidenceQuote seconds={seconds} speaker={first.speaker} quote={first.quote} quoteEnglish={first.quote_english} verified={verified} />
      </div>
    </>
  );
}

export function SheetSection({ id, title, count, children, className }: { id: string; title: string; count?: number; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={clsx("scroll-mt-20", className)}>
      <SectionLabel id={`${id}-title`} count={count}>
        {title}
      </SectionLabel>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function ExecutiveSummary({ bullets }: { bullets: string[] }) {
  if (!bullets.length) return null;
  return (
    <ul className="flex flex-col gap-1.5 text-[15px] leading-[22px] text-ink-2 lg:text-[14px] lg:leading-[20px]">
      {bullets.map((b, i) => (
        <li key={i} className="flex gap-2.5">
          <span aria-hidden="true" className="mt-[9px] size-1 shrink-0 rounded-full bg-ink-3" />
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}

export function DecisionList({ view, ctx }: { view: SheetView; ctx: EvidenceContext }) {
  if (!view.decisions.length) return <QuietLine>No decisions were recorded.</QuietLine>;
  return (
    <ol className="divide-y divide-hairline">
      {view.decisions.map((d, i) => (
        <li key={d.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
          <span className="w-5 shrink-0 pt-px font-mono text-[12px] text-ink-3 tnum">{i + 1}</span>
          <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-ink lg:text-[14px] lg:leading-[20px]">
            {d.statement}
            {d.decided_by !== "unclear" && <span className="ml-1.5 text-[12px] text-ink-3">{d.decided_by === "joint" ? "joint" : d.decided_by === "dny" ? "by DNY" : "by client"}</span>}
          </p>
          <EntryEvidence evidence={d.evidence} id={d.id} view={view} ctx={ctx} />
        </li>
      ))}
    </ol>
  );
}

const CATEGORY: Record<string, string> = { money: "Money", date: "Date", quantity: "Quantity", metric: "Metric", contract: "Contract", staffing: "Staffing", property: "Property", process: "Process", other: "" };

export function FactGrid({ view, ctx }: { view: SheetView; ctx: EvidenceContext }) {
  if (!view.key_facts.length) return <QuietLine>No facts or numbers were called out.</QuietLine>;
  return (
    <dl className="grid gap-x-6 sm:grid-cols-2">
      {view.key_facts.map((f) => (
        <div key={f.id} className="flex flex-wrap items-start gap-x-2 gap-y-1 border-t border-hairline py-2.5 first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
          <dt className="w-full text-[12px] leading-4 text-ink-3">{CATEGORY[f.category] || "Fact"}</dt>
          <dd className="min-w-0 flex-1 text-[15px] leading-[22px] text-ink lg:text-[14px] lg:leading-[20px]">
            {f.fact}
            {f.normalized_value && <span className="ml-2 font-mono text-[12px] text-ink-3 tnum">{f.normalized_value}</span>}
          </dd>
          <EntryEvidence evidence={f.evidence} id={f.id} view={view} ctx={ctx} />
        </div>
      ))}
    </dl>
  );
}

export function RiskList({ view, ctx }: { view: SheetView; ctx: EvidenceContext }) {
  if (!view.risks.length) return <QuietLine>No risks were raised.</QuietLine>;
  return (
    <ul className="flex flex-col gap-2">
      {view.risks.map((r) => (
        <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-l-[3px] border-l-signal pl-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-[22px] text-ink lg:text-[14px] lg:leading-[20px]">{r.description}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
              <span className={r.severity === "high" ? "font-medium text-signal" : ""}>{r.severity} severity</span>
              <span>· affects {r.affects === "both" ? "both sides" : r.affects === "unclear" ? "unclear" : r.affects === "dny" ? "DNY" : "the client"}</span>
            </p>
            {r.mitigation_discussed && <p className="mt-1 text-[13px] leading-[18px] text-ink-2">Discussed: {r.mitigation_discussed}</p>}
          </div>
          <EntryEvidence evidence={r.evidence} id={r.id} view={view} ctx={ctx} />
        </li>
      ))}
    </ul>
  );
}

export function QuestionList({ view, ctx }: { view: SheetView; ctx: EvidenceContext }) {
  if (!view.open_questions.length) return <QuietLine>No open questions.</QuietLine>;
  return (
    <ul className="divide-y divide-hairline">
      {view.open_questions.map((q) => (
        <li key={q.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
          <Question size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-slate" />
          <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-ink lg:text-[14px] lg:leading-[20px]">
            {q.question}
            {q.needs_answer_from !== "unclear" && <span className="ml-1.5 text-[12px] text-slate">{q.needs_answer_from === "dny" ? "DNY to answer" : "client to answer"}</span>}
          </p>
          <EntryEvidence evidence={q.evidence} id={q.id} view={view} ctx={ctx} />
        </li>
      ))}
    </ul>
  );
}

export function NextMeetingCard({ view, ctx, now = new Date() }: { view: SheetView; ctx: EvidenceContext; now?: Date }) {
  const next = view.next_meeting;
  if (!next || !next.mentioned) return <QuietLine>No next meeting was set.</QuietLine>;
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-card border border-hairline p-3">
      <CalendarBlank size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-2" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-[22px] font-medium text-ink lg:text-[14px] lg:leading-[20px]">
          {next.date ? (
            <>
              <span className="font-mono tnum">{formatShortDate(next.date)}</span>
              <span className="ml-1.5 font-normal text-ink-3">{relativeDue(next.date, now)}</span>
            </>
          ) : (
            next.raw_phrase ?? "Date not fixed"
          )}
        </p>
        {next.date && next.raw_phrase && <p className="text-[12px] text-ink-3">“{next.raw_phrase}”</p>}
        {next.purpose && <p className="mt-1 text-[14px] leading-[20px] text-ink-2">{next.purpose}</p>}
      </div>
      {next.evidence.length > 0 && <EntryEvidence evidence={next.evidence} id="next_meeting" view={view} ctx={ctx} />}
    </div>
  );
}

export function SentimentLine({ view }: { view: SheetView }) {
  const s = view.client_sentiment;
  if (!s) return null;
  const tone = s.label === "frustrated" || s.label === "concerned" ? "signal" : s.label === "mixed" ? "sienna" : s.label === "neutral" ? "neutral" : "bottle";
  return (
    <p className="flex flex-wrap items-start gap-2 text-[14px] leading-[20px] text-ink-2">
      <Chip tone={tone}>{SENTIMENT_WORDS[s.label]}</Chip>
      <span className="min-w-0 flex-1">
        {s.summary}
        {s.drivers.length > 0 && <span className="text-ink-3"> — {s.drivers.join(", ")}</span>}
      </span>
    </p>
  );
}

export const purposeWord = (purpose: keyof typeof PURPOSE_WORDS | undefined): string | null => (purpose ? PURPOSE_WORDS[purpose] : null);
