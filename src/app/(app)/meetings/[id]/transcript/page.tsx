import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getMeetingHeader, getTranscriptTurns } from "@/lib/data/meetings";
import { formatDateTimeIst, formatTimestamp } from "@/lib/format";
import { parseTurns } from "@/lib/sheet/load";
import { hasDevanagari } from "@/lib/ui/text";
import { EmptyState } from "@/components/ui/states";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  await requireUser();
  const meeting = await getMeetingHeader(id).catch(() => null);
  return { title: meeting?.title ? `Transcript · ${meeting.title}` : "Transcript" };
}

// The stored speaker turns as lines with timestamps. Its own route so the transcript only loads
// when someone asks for it; the sheet page never carries it.
export default async function TranscriptPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireUser();
  const [meeting, transcript] = await Promise.all([getMeetingHeader(id), getTranscriptTurns(id)]);
  if (!meeting) notFound();
  const turns = parseTurns(transcript?.turns ?? null);
  const speakers = [...new Set(turns.map((t) => t.speaker))];

  return (
    <div className="mx-auto max-w-[880px]">
      <Link href={`/meetings/${id}`} className="mb-3 inline-flex h-8 items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} aria-hidden="true" />
        Back to the sheet
      </Link>
      <header className="mb-4">
        <h1 className="text-[20px] leading-7 font-semibold tracking-[-0.01em] text-ink">Transcript</h1>
        <p className="mt-0.5 text-[13px] leading-[18px] text-ink-3">
          {meeting.title ?? "Untitled meeting"} · {formatDateTimeIst(meeting.happened_at)}
          {transcript && ` · ${turns.length} turns · ${speakers.length} speaker${speakers.length === 1 ? "" : "s"}`}
          {transcript?.speaker_labels_reliable === false && " · speaker names did not match the invitees"}
        </p>
      </header>

      {!transcript || turns.length === 0 ? (
        <EmptyState title="No transcript yet.">tl;dv has not delivered the transcript for this meeting. The cron keeps asking for up to 48 hours.</EmptyState>
      ) : (
        <ol className="card divide-y divide-hairline">
          {turns.map((t, i) => (
            <li key={i} id={`t-${Math.floor(t.startSec)}`} className="flex gap-3 px-4 py-2.5 sm:gap-4">
              <span className="w-[52px] shrink-0 pt-0.5 font-mono text-[12px] text-ink-3 tnum">{formatTimestamp(t.startSec)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] leading-4 font-medium text-ink-2">{t.speaker}</p>
                <p className={hasDevanagari(t.text) ? "devanagari text-[15px] leading-[22px] text-ink" : "text-[15px] leading-[22px] text-ink lg:text-[14px] lg:leading-[20px]"}>{t.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
