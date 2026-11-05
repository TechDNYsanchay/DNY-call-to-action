import { ArrowSquareOut, TextAlignLeft } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { MeetingPageData } from "@/lib/data/meetings";
import type { ClientRef } from "@/lib/data/types";
import { formatDateTimeIst, formatDuration, formatTimeIst } from "@/lib/format";
import { type Attendee, groupBySide } from "@/lib/ui/participants";
import { percent, sourceLabel, typeLabel } from "@/lib/ui/status";
import { Button, buttonClass } from "@/components/ui/button";
import { Avatar, Chip } from "@/components/ui/chip";
import { DecideTypeDialog } from "@/components/review/decide-type-dialog";
import { RerunButton } from "./rerun-button";

// The right-hand rail (desktop) or the Details sheet (tablet, phone): recording, attendees grouped
// DNY / client, the processing log from agent_runs, the classification with its override, re-run,
// and the sheet's version. Server component; the dialogs inside are client islands.

const RUN_WORDS: Record<string, string> = { claim: "Claimed", classify: "Classified", extract: "Sheet", skip: "Skipped", fail: "Gave up", release: "Released" };

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline py-4 first:border-t-0 first:pt-0">
      <h3 className="label-xs mb-2">{title}</h3>
      {children}
    </section>
  );
}

export function ContextRailContent({ data, attendees, clients, external, isAdmin, timestampParam }: { data: MeetingPageData; attendees: Attendee[]; clients: ClientRef[]; external: string[]; isAdmin: boolean; timestampParam: string | null }) {
  const { meeting, sheet, runs, versions } = data;
  const sides = groupBySide(attendees);
  const canRerun = isAdmin && meeting.type === "client" && meeting.transcript_ready && meeting.process_status !== "processing";
  return (
    <div className="text-[13px] leading-[18px] text-ink-2">
      <RailSection title="Recording">
        {meeting.tldv_url ? (
          <a href={meeting.tldv_url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm", "w-full justify-between")}>
            <span>Open in tl;dv</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-3 tnum">
              {formatDuration(meeting.duration_sec)}
              <ArrowSquareOut size={14} aria-hidden="true" />
            </span>
          </a>
        ) : (
          <p className="text-ink-3">No recording link.</p>
        )}
        {meeting.transcript_ready && (
          <Link href={`/meetings/${meeting.id}/transcript`} className={buttonClass("ghost", "sm", "mt-1.5 w-full justify-start")}>
            <TextAlignLeft size={14} aria-hidden="true" />
            Read the transcript
          </Link>
        )}
        {!timestampParam && meeting.tldv_url && <p className="mt-2 text-[12px] text-ink-3">Timestamp links open the recording from the start until tl;dv&apos;s time parameter is confirmed.</p>}
      </RailSection>

      <RailSection title="Attendees">
        {attendees.length === 0 && <p className="text-ink-3">No invitees on the tl;dv record.</p>}
        {(["dny", "client"] as const).map((side) => {
          const list = sides[side];
          if (!list.length) return null;
          return (
            <div key={side} className="mb-2 last:mb-0">
              <p className={side === "dny" ? "text-[12px] font-medium text-bottle" : "text-[12px] font-medium text-sienna"}>{side === "dny" ? "DNY" : meeting.type === "client" ? "Client" : "Outside DNY"}</p>
              <ul className="mt-1 flex flex-col gap-1">
                {list.map((a) => (
                  <li key={a.email ?? a.name ?? ""} className="flex items-center gap-2">
                    <Avatar name={a.name} email={a.email} side={a.side} size={20} />
                    <span className="truncate text-ink">{a.name ?? a.email}</span>
                    {a.is_organizer && <span className="text-[11px] text-ink-3">organiser</span>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </RailSection>

      <RailSection title="Classification">
        <p className="flex flex-wrap items-center gap-1.5">
          <Chip tone={meeting.type === "client" ? "bottle" : meeting.type === "sales" ? "sienna" : "neutral"}>{typeLabel(meeting.type)}</Chip>
          <span className="text-ink-3">
            {sourceLabel(meeting.type_source)}
            {meeting.type_confidence != null && meeting.type_source !== "human" ? ` · ${percent(meeting.type_confidence)}` : ""}
          </span>
        </p>
        {meeting.type_reason && <p className="mt-1.5">{meeting.type_reason}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <DecideTypeDialog meetingId={meeting.id} currentType={meeting.type} currentClientId={meeting.client_id} clients={clients} external={external} clientNameGuess={meeting.client_name_guess} trigger={<Button size="sm">Change type</Button>} />
          {canRerun && <RerunButton meetingId={meeting.id} size="sm" failed={meeting.process_status === "failed"} label={meeting.process_status === "failed" ? "Retry" : "Re-run"} />}
        </div>
      </RailSection>

      <RailSection title="Processing log">
        {runs.length === 0 ? (
          <p className="text-ink-3">The routine has not touched this meeting yet.</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {runs.map((r) => (
              <li key={r.id} className="flex gap-2">
                <span className="w-[42px] shrink-0 font-mono text-[12px] text-ink-3 tnum">{formatTimeIst(r.created_at)}</span>
                <span className="min-w-0 flex-1">
                  <span className={r.status === "ok" ? "text-ink" : "text-signal"}>{RUN_WORDS[r.kind] ?? r.kind}</span>
                  {r.status !== "ok" && <span className="text-signal"> · {r.status}</span>}
                  {r.summary && <span className="block text-[12px] text-ink-3">{r.summary}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-[12px] text-ink-3">
          {meeting.process_attempts} attempt{meeting.process_attempts === 1 ? "" : "s"} · seen {formatDateTimeIst(meeting.created_at)} · via {meeting.source}
        </p>
      </RailSection>

      {sheet && (
        <RailSection title="Sheet">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[12px] tnum">
            <dt className="text-ink-3">version</dt>
            <dd className="text-ink">
              {sheet.version}
              {versions > 1 ? ` of ${versions}` : ""}
            </dd>
            <dt className="text-ink-3">model</dt>
            <dd className="truncate text-ink">{sheet.model ?? "not recorded"}</dd>
            <dt className="text-ink-3">prompt</dt>
            <dd className="text-ink">{sheet.prompt_version}</dd>
            <dt className="text-ink-3">written</dt>
            <dd className="text-ink">{formatDateTimeIst(sheet.created_at)}</dd>
          </dl>
        </RailSection>
      )}
    </div>
  );
}
