import Link from "next/link";
import type { CallLine } from "@/lib/data/calls";
import type { AgentRunSummary, ClientRef, MeetingSummary, PhoneCallRow, SheetRow } from "@/lib/data/types";
import { formatDateTimeIst, formatTimeIst, formatTimestamp } from "@/lib/format";
import { audioFormatName, type RecordingAvailability } from "@/lib/ui/audio-access";
import { formatDayIst } from "@/lib/ui/call-status";
import { formatSpan } from "@/lib/ui/latency";
import { deletedText } from "@/lib/ui/player";
import { percent, sourceLabel } from "@/lib/ui/status";
import { Avatar, Chip } from "@/components/ui/chip";
import { type CallPermissions, CallActions, LinkClientSelect } from "./call-actions";
import { DownloadRecordingButton } from "./recording-player";

// The call page's right-hand rail (desktop) or Details sheet (tablet, phone): who was on the call, the
// recording, the processing steps with their times (admins also see how long each took and the routine's
// notes), and the actions this person may take.

const RUN_WORDS: Record<string, string> = { claim: "Claimed", classify: "Classified", extract: "Sheet", skip: "Deleted", fail: "Gave up", release: "Released" };

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline py-4 first:border-t-0 first:pt-0">
      <h3 className="label-xs mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-0.5">
      <dt className="w-[76px] shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 flex-1 text-ink">{children}</dd>
    </div>
  );
}

const megabytes = (bytes: number | null): string | null => (bytes ? `${(bytes / 1_048_576).toFixed(bytes < 1_048_576 ? 2 : 1)} MB` : null);

export interface CallRailProps {
  meeting: MeetingSummary;
  call: PhoneCallRow;
  line: CallLine | null;
  sheet: SheetRow | null;
  versions: number;
  runs: AgentRunSummary[];
  clients: ClientRef[];
  isAdmin: boolean;
  isBusiness: boolean;
  availability: RecordingAvailability;
  lengthSec: number;
  retentionDays: number;
  can: CallPermissions;
}

export function CallRail({ meeting, call, line, sheet, versions, runs, clients, isAdmin, isBusiness, availability, lengthSec, retentionDays, can }: CallRailProps) {
  const steps: Array<[string, string | null]> = [
    ["Received", call.stored_at],
    ["Transcribed", call.transcribed_at],
    ["Queued", call.ready_at],
    ["Picked up", call.first_claimed_at],
    ["Sheet", call.first_sheet_at],
  ];
  const keptUntil = Date.parse(call.stored_at) + retentionDays * 86_400_000;
  return (
    <div className="text-[13px] leading-[18px] text-ink-2">
      <RailSection title="On the call">
        <dl>
          <Row label="Phone">{line?.name ?? "A removed line"}</Row>
          <Row label="People">
            {line?.members.length ? (
              <ul className="flex flex-col gap-1">
                {line.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <Avatar name={m.full_name} email={m.email} side="dny" size={20} />
                    <span className="truncate">{m.full_name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-ink-3">No person set for this phone</span>
            )}
          </Row>
          {isBusiness && call.counterpart_name && <Row label="Saved as">{call.counterpart_name}</Row>}
          <Row label="Number">
            <span className="font-mono tnum">{call.counterpart_masked}</span>
          </Row>
          {isBusiness && (
            <Row label="Type">
              <span className="flex flex-wrap items-center gap-1.5">
                <Chip tone={meeting.type === "client" ? "bottle" : "neutral"}>{meeting.type === "client" ? "Client call" : "Vendor call"}</Chip>
                <span className="text-ink-3">
                  {sourceLabel(meeting.type_source)}
                  {meeting.type_confidence != null && meeting.type_source !== "human" ? ` · ${percent(meeting.type_confidence)}` : ""}
                </span>
              </span>
            </Row>
          )}
        </dl>
        {meeting.type === "client" && !call.purged_at && (
          <div className="mt-3">
            {meeting.client ? (
              <Link href={`/clients/${meeting.client.id}`} className="mb-1.5 inline-flex h-8 items-center text-[13px] font-medium text-ink underline decoration-strong underline-offset-2 hover:decoration-ink">
                {meeting.client.name}
              </Link>
            ) : (
              <p className="mb-1.5 text-ink-3">Not linked to a client yet.</p>
            )}
            <LinkClientSelect callId={meeting.id} clientId={meeting.client_id} clients={clients} />
          </div>
        )}
      </RailSection>

      <RailSection title="Recording">
        {availability === "not_work" ? (
          <p className="text-ink-3">{deletedText(call.skip_code)}.</p>
        ) : availability === "deleted" ? (
          <p className="text-ink-3">Deleted after {retentionDays} days{call.media_deleted_at ? `, on ${formatDayIst(call.media_deleted_at)}` : ""}. The sheet stays.</p>
        ) : (
          <>
            <p className="font-mono text-[12px] text-ink-3 tnum">{[audioFormatName(call.recording_mime), megabytes(call.recording_bytes), formatTimestamp(lengthSec)].filter(Boolean).join(" · ")}</p>
            {availability === "withheld" ? (
              <p className="mt-1.5 text-ink-3">Opens once the call is confirmed as a client or vendor call.</p>
            ) : (
              <DownloadRecordingButton className="mt-1.5 -ml-2.5" />
            )}
            <p className="mt-1.5 text-[12px] text-ink-3">{isBusiness ? `Kept for ${retentionDays} days, until ${formatDayIst(keptUntil)}.` : "Deleted unless it is confirmed as a work call."}</p>
          </>
        )}
      </RailSection>

      <RailSection title="Processing">
        <ol className="flex flex-col gap-1">
          {steps.map(([label, at], i) => {
            const prev = i > 0 ? steps[i - 1][1] : call.call_ended_at;
            const took = at && prev ? (Date.parse(at) - Date.parse(prev)) / 1000 : NaN;
            return (
              <li key={label} className="flex items-baseline gap-2">
                <span className="w-[76px] shrink-0 text-ink-3">{label}</span>
                <span className="font-mono text-[12px] text-ink tnum">{at ? formatTimeIst(at) : "—"}</span>
                {isAdmin && at && Number.isFinite(took) && took >= 0 && <span className="text-[12px] text-ink-3">+{formatSpan(took)}</span>}
              </li>
            );
          })}
        </ol>
        {isAdmin && runs.length > 0 && (
          <ol className="mt-3 flex flex-col gap-1.5 border-t border-hairline pt-3">
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
        {isAdmin && sheet && (
          <p className="mt-3 font-mono text-[12px] text-ink-3 tnum">
            sheet v{sheet.version}
            {versions > 1 ? ` of ${versions}` : ""} · {sheet.prompt_version} · {formatDateTimeIst(sheet.created_at)}
          </p>
        )}
        {isAdmin && (
          <p className="mt-2 text-[12px] text-ink-3">
            {meeting.process_attempts} attempt{meeting.process_attempts === 1 ? "" : "s"} · {call.stt_attempts} transcription attempt{call.stt_attempts === 1 ? "" : "s"}
            {call.stt_error ? ` · last error: ${call.stt_error}` : ""}
          </p>
        )}
      </RailSection>

      <RailSection title="Actions">
        <CallActions callId={meeting.id} can={can} />
      </RailSection>
    </div>
  );
}
