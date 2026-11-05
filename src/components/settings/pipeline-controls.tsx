"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { backfillAction, replayAction, setPipelinePaused } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/fields";
import { useToast } from "@/components/ui/toast";

// Settings > Integrations: the pipeline switch, "Replay a tl;dv meeting" and "Backfill the last N
// days" with a confirm step that shows the estimate before anything is fetched.

export function PipelineToggle({ paused }: { paused: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const flip = () =>
    start(async () => {
      const result = await setPipelinePaused(!paused);
      if (!result.ok) return toast({ message: result.error, tone: "signal" });
      toast({ message: paused ? "Pipeline resumed" : "Pipeline paused. New meetings are stored but not handed to the routine." });
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={paused}
        aria-label="Pipeline paused"
        onClick={flip}
        disabled={pending}
        className={clsx("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-150", paused ? "border-signal bg-signal" : "border-strong bg-inset")}
      >
        <span className={clsx("absolute size-5 rounded-full bg-sheet shadow-card transition-transform duration-150", paused ? "translate-x-[25px]" : "translate-x-[3px]")} />
      </button>
      <span className={clsx("text-[14px] font-medium", paused ? "text-signal" : "text-ink")}>{paused ? "Paused" : "Running"}</span>
      <span className="text-[13px] text-ink-3">{paused ? "The routine gets no work until this is switched back on." : "Meetings become ready as transcripts land."}</span>
    </div>
  );
}

export function ReplayForm() {
  const router = useRouter();
  const toast = useToast();
  const [id, setId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setMessage(null);
        start(async () => {
          const result = await replayAction(id);
          if (!result.ok) return setError(result.error);
          setMessage(`Fetched. The meeting is now "${result.data?.status ?? "stored"}".`);
          setId("");
          toast({ message: "Meeting replayed from tl;dv" });
          router.refresh();
        });
      }}
    >
      <Field label="tl;dv meeting id" htmlFor="replay-id" hint="Fetches the meeting and its transcript again, exactly as the webhook would." className="flex-1" error={error}>
        <Input id="replay-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. 6723f1c2…" autoComplete="off" />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending || !id.trim()} className="h-11 lg:h-9">
        {pending ? "Fetching…" : "Replay"}
      </Button>
      {message && (
        <p role="status" className="text-[13px] text-ink-2 sm:basis-full">
          {message}
        </p>
      )}
    </form>
  );
}

export function BackfillForm({ maxDays }: { maxDays: number }) {
  const router = useRouter();
  const toast = useToast();
  const [days, setDays] = useState(14);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const span = Math.min(Math.max(Math.floor(days) || 1, 1), maxDays);

  const run = () =>
    start(async () => {
      setError(null);
      const res = await backfillAction(span);
      setConfirming(false);
      if (!res.ok) return setError(res.error);
      setResult(`${res.data?.seen ?? 0} meetings seen in tl;dv, ${res.data?.created ?? 0} new. Transcripts follow with the next cron ticks.`);
      toast({ message: `Backfill done: ${res.data?.created ?? 0} new meetings` });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Days to look back" htmlFor="backfill-days" hint={`1 to ${maxDays}. Meetings already known are left alone.`} error={error}>
          <Input id="backfill-days" type="number" min={1} max={maxDays} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-28" />
        </Field>
        {!confirming && (
          <Button variant="secondary" onClick={() => setConfirming(true)} className="h-11 lg:h-9">
            Backfill
          </Button>
        )}
      </div>
      {confirming && (
        <div className="rounded-card bg-inset p-3 text-[14px] leading-[20px] text-ink-2">
          <p className="font-medium text-ink">Fetch the last {span} days from tl;dv?</p>
          <p className="mt-1">Estimate: about {Math.round(span * 1.5)} to {span * 4} recordings at DNY&apos;s usual pace; each client meeting then takes one routine run (no extra cost on the Max plan). Backfilled sheets send no emails.</p>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={run} disabled={pending}>
              {pending ? "Fetching…" : `Fetch ${span} days`}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {result && (
        <p role="status" className="text-[13px] text-ink-2">
          {result}
        </p>
      )}
    </div>
  );
}
