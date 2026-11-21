"use client";

import clsx from "clsx";
import { ArrowClockwise, CaretDown, Warning } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import {
  type CallsNumberSetting,
  previewLineOff,
  requestReread,
  retryFailedCopies,
  setCallsNumberSetting,
  setCallsPaused,
  setDeepgramOptOut,
  setDnyNumbers,
  setLineEnabled,
  setLineLabel,
  setLineSalesSheets,
  setLineMembers,
  switchLineOff,
} from "@/app/(app)/settings/calls-actions";
import type { AdminLine, PhoneCallsAdmin } from "@/lib/data/calls";
import type { PersonSummary } from "@/lib/data/types";
import { WIDE_READ_DAYS, ymdMinus } from "@/lib/calls/schedule";
import { formatTimeIst, istDate, timeAgo } from "@/lib/format";
import type { ActionResult } from "@/lib/ui/action-result";
import { feedProblems, formatCallWhen, formatDayIst } from "@/lib/ui/call-status";
import { formatSpan } from "@/lib/ui/latency";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { FormRow, Input, NativeSelect, Textarea } from "@/components/ui/fields";
import { Dialog, DialogContent, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { RelativeTime } from "@/components/ui/relative-time";
import { InlineNote } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";

// Settings > Phone calls, for admins: whether calls run and why not, the switch, every DNY phone Callyzer
// reports (on or off, its name, who uses it, today's calls), the limits, a day to read again, the last calls
// deleted as not work calls, and how long calls take to become sheets. Switching calls or a line on asks the
// admin to confirm the people on those phones have been told.

const SKIP_WORDS: Record<string, string> = {
  personal: "Personal",
  internal: "DNY colleague",
  sales: "Sales lead",
  wrong_number: "Wrong number",
  no_content: "No conversation",
  not_business: "Marked not a work call",
  undecided: "Not confirmed in time",
  line_off: "Line switched off",
  no_speech: "No speech",
};
const BY_WORDS: Record<string, string> = { routine: "the routine", person: "a person", system: "automatically" };

function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = <T,>(action: () => Promise<ActionResult<T>>, message: string | ((data: T | undefined) => string), after?: (result: ActionResult<T>) => void) =>
    start(async () => {
      const result = await action();
      after?.(result);
      if (!result.ok) {
        toast({ message: result.error, tone: "signal" });
        return;
      }
      toast({ message: typeof message === "string" ? message : message(result.data) });
      router.refresh();
    });
  return { pending, run };
}

/**
 * A confirm dialog whose button waits for the "they have been told" box. The box starts empty every time the
 * dialog opens, however it last closed (Cancel, a confirmed switch, Escape): the admin confirms each time.
 */
function ToldDialog({ open, onOpenChange, title, children, checkbox, confirm, pending, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; checkbox: string; confirm: string; pending: boolean; onConfirm: () => void }) {
  const [told, setTold] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTold(false);
  }
  const close = () => {
    setTold(false);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent title={title}>
        <div className="text-[14px] leading-[20px] text-ink-2">{children}</div>
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-card bg-inset p-3 text-[14px] leading-[20px] text-ink select-none">
          <input type="checkbox" checked={told} onChange={(e) => setTold(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]" />
          {checkbox}
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!told || pending} onClick={onConfirm}>
            {pending ? "Saving…" : confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------ Status

function statusChip(data: PhoneCallsAdmin): { label: string; tone: "bottle" | "sienna" | "signal" | "neutral" } {
  const feed = data.feed;
  if (feed?.off === "not_configured") return { label: "Not configured", tone: "neutral" };
  if (data.settings.paused) return { label: "Paused", tone: "sienna" };
  if (feed?.pollError || feed?.copyError || feed?.sttError === "auth" || feed?.sttError === "credit" || feed?.off === "tripwire") return { label: "Error", tone: "signal" };
  return { label: "Running", tone: "bottle" };
}

/** "A", "A and B", "A, B and C". */
const andList = (names: string[]): string => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? ""));
/** How register_phone_lines compares a line's name with the initial lines: case and extra spaces aside. */
const sameName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

function PauseSwitch({ paused, initialLines, lines }: { paused: boolean; initialLines: string[]; lines: AdminLine[] }) {
  const { pending, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  // What unpausing does, line by line: initial lines Callyzer has not reported yet start when it first does;
  // lines already on keep their start, so the next wide read picks up the calls they made while paused.
  const seen = new Set(lines.map((l) => sameName(l.callyzer_name)));
  const unseen = initialLines.filter((n) => !seen.has(sameName(n)));
  const onLines = lines.filter((l) => l.enabled).map((l) => l.name);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Switch checked={!paused} disabled={pending} label="Phone calls on" onCheckedChange={(on) => (on ? setConfirming(true) : run(() => setCallsPaused(true), "Phone calls paused. Nothing is read, copied or transcribed until they are switched on."))} />
      <span className={clsx("text-[14px] font-medium", paused ? "text-sienna" : "text-ink")}>{paused ? "Paused" : "On"}</span>
      <span className="text-[13px] text-ink-3">{paused ? "Callyzer is not read; no call is copied or transcribed." : "Callyzer is read every 2 minutes outside Sales QA's minutes."}</span>
      <ToldDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Switch phone calls on?"
        checkbox="The people who use these phones have been told their calls are recorded, transcribed and analysed by this app."
        confirm="Switch on"
        pending={pending}
        onConfirm={() => run(() => setCallsPaused(false, true), "Phone calls are on. New calls appear within a few minutes.", (r) => r.ok && setConfirming(false))}
      >
        {unseen.length > 0 && (
          <p>
            Unpausing switches on {andList(unseen)} when Callyzer first reports {unseen.length === 1 ? "it" : "them"}, and analyses {unseen.length === 1 ? "its" : "their"} calls from that moment.
          </p>
        )}
        {onLines.length > 0 && (
          <p className={clsx(unseen.length > 0 && "mt-2")}>
            {andList(onLines)} {onLines.length === 1 ? "is" : "are"} on already: calls made on {onLines.length === 1 ? "it" : "them"} while phone calls were paused are analysed too, from today and the {WIDE_READ_DAYS} days before. To start a line from now instead, switch it off and on again first.
          </p>
        )}
        {unseen.length === 0 && onLines.length === 0 && <p>No phone line is on yet. A line you switch on below is analysed from the moment you switch it on.</p>}
        <p className="mt-2">Have the people who use these phones been told?</p>
      </ToldDialog>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- Lines

function LineSwitch({ line }: { line: AdminLine }) {
  const { pending, run } = useAction();
  const [confirmOn, setConfirmOn] = useState(false);
  const [offCount, setOffCount] = useState<number | null>(null);
  const [checking, startCheck] = useTransition();
  const toast = useToast();
  const askOff = () =>
    startCheck(async () => {
      const result = await previewLineOff(line.id);
      if (!result.ok) return toast({ message: result.error, tone: "signal" });
      setOffCount(result.data?.undecided ?? 0);
    });
  return (
    <>
      <Switch checked={line.enabled} disabled={pending || checking} label={`${line.name} ${line.enabled ? "on" : "off"}`} onCheckedChange={(on) => (on ? setConfirmOn(true) : askOff())} />
      <ToldDialog
        open={confirmOn}
        onOpenChange={setConfirmOn}
        title={`Switch on ${line.name}?`}
        checkbox="The people who use this phone know its calls are recorded, transcribed and analysed by this app."
        confirm="Switch on"
        pending={pending}
        onConfirm={() => run(() => setLineEnabled(line.id, true, true), `${line.name} is on; its calls are analysed from now`, (r) => r.ok && setConfirmOn(false))}
      >
        Calls of {line.name} that start from now on are copied, transcribed and analysed. Earlier calls never are.
      </ToldDialog>
      <Dialog open={offCount !== null} onOpenChange={(o) => !o && setOffCount(null)}>
        <DialogContent title={`Switch off ${line.name}?`}>
          <p className="text-[14px] leading-[20px] text-ink-2">
            {offCount
              ? `Switch off and delete the ${offCount === 1 ? "call" : `${offCount} calls`} from this line that ${offCount === 1 ? "is" : "are"} not yet confirmed as work calls? Client and vendor calls are kept.`
              : "Its new calls are no longer analysed. Client and vendor calls are kept."}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOffCount(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant={offCount ? "danger" : "primary"} disabled={pending} onClick={() => run(() => switchLineOff(line.id), (d) => (d?.purged ? `${line.name} is off; ${d.purged} undecided call${d.purged === 1 ? "" : "s"} deleted` : `${line.name} is off`), (r) => r.ok && setOffCount(null))}>
              {pending ? "Switching off…" : offCount ? "Switch off and delete" : "Switch off"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LineSalesSheets({ line }: { line: AdminLine }) {
  const { pending, run } = useAction();
  return (
    <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
      <input
        type="checkbox"
        checked={line.salesGetSheets}
        disabled={pending}
        onChange={(e) => {
          const on = e.currentTarget.checked;
          run(() => setLineSalesSheets(line.id, on), on ? `Sales enquiries on ${line.name} now get a CTA` : `Sales enquiries on ${line.name} are left to Sales QA again`);
        }}
        className="size-4 accent-[var(--color-bottle)]"
      />
      Sales enquiries get a CTA too
    </label>
  );
}

function LineLabel({ line }: { line: AdminLine }) {
  const { pending, run } = useAction();
  const [value, setValue] = useState(line.label ?? "");
  const save = () => {
    if (value.trim() === (line.label ?? "")) return;
    run(() => setLineLabel(line.id, value), value.trim() ? `Shown as “${value.trim()}”` : "Back to the automatic name");
  };
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      maxLength={60}
      disabled={pending}
      aria-label={`Name shown for ${line.callyzer_name}`}
      placeholder={line.name}
      className="h-9 bg-sheet lg:h-8 lg:text-[13px]"
    />
  );
}

function LinePeople({ line, people }: { line: AdminLine; people: PersonSummary[] }) {
  const { pending, run } = useAction();
  const [chosen, setChosen] = useState<string[]>(line.members.map((m) => m.id));
  const [open, setOpen] = useState(false);
  const summary = line.members.length ? line.members.map((m) => m.full_name.split(" ")[0]).join(", ") : "Nobody";
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setChosen(line.members.map((m) => m.id));
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" aria-label={`People on ${line.name}: ${summary}. Change`} className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-chip border border-hairline bg-sheet px-2.5 text-[13px] text-ink transition-colors duration-150 hover:border-strong lg:h-8">
          <span className="truncate">{summary}</span>
          <CaretDown size={12} aria-hidden="true" className="shrink-0 text-ink-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[360px] overflow-y-auto p-1.5">
        <p className="px-2 pt-1.5 pb-1 text-[11px] font-semibold text-ink-3">Who uses this phone</p>
        {people.map((p) => (
          <label key={p.id} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-[13px] text-ink hover:bg-raised">
            <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={chosen.includes(p.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((id) => id !== p.id)))} />
            <span className="flex-1 truncate">{p.full_name}</span>
            {p.dept && <span className="truncate text-[11px] text-ink-3">{p.dept}</span>}
          </label>
        ))}
        <div className="flex justify-end gap-2 border-t border-hairline px-1 pt-2 pb-1">
          <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => setLineMembers(line.id, chosen), "People saved", (r) => r.ok && setOpen(false))}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LineToday({ line }: { line: AdminLine }) {
  const t = line.today;
  const missing = Math.max(0, t.candidates - t.withLink);
  return (
    <div className="text-[13px] leading-[18px] text-ink-2">
      <p className="tnum">
        {t.calls} call{t.calls === 1 ? "" : "s"} · {t.analysed} analysed
        {t.candidates > 0 && ` · no recording on ${missing} of ${t.candidates}`}
      </p>
      {t.candidates > 0 && t.withLink === 0 && <p className="text-[12px] text-sienna">Recording may be off for this phone in Callyzer.</p>}
    </div>
  );
}

function LinesList({ lines, people, initialLines, nowIso }: { lines: AdminLine[]; people: PersonSummary[]; initialLines: string[]; nowIso: string }) {
  if (!lines.length) return <p className="text-[14px] leading-[20px] text-ink-3">No phone lines yet. Callyzer&apos;s lines appear here after the first read once phone calls are on.</p>;
  return (
    <div>
      <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_auto] gap-4 border-b border-hairline pb-2 label-xs md:grid">
        <span>Line</span>
        <span>Shown as</span>
        <span>People</span>
        <span>Today</span>
        <span className="text-right">On</span>
      </div>
      <ul className="divide-y divide-hairline">
        {lines.map((line) => (
          <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_auto] md:items-center">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium text-ink">{line.callyzer_name}</p>
              <p className="font-mono text-[12px] text-ink-3 tnum">{line.phone}</p>
              <p className="text-[12px] text-ink-3">
                {line.enabled && line.analyseFrom ? `On since ${formatCallWhen(line.analyseFrom, new Date(nowIso))}` : "Off"}
                {line.lastCallAt && ` · last call ${timeAgo(line.lastCallAt, new Date(nowIso))}`}
              </p>
              <LineSalesSheets line={line} />
              {line.enabled && line.members.length === 0 && (
                <Chip tone="sienna" className="mt-1.5 h-auto py-1 leading-[16px] whitespace-normal">
                  <Warning size={12} aria-hidden="true" className="shrink-0" />
                  No person set: this line&apos;s actions reach nobody&apos;s My actions
                </Chip>
              )}
            </div>
            <div className="col-start-2 row-start-1 flex justify-end md:col-start-5">
              <LineSwitch line={line} />
            </div>
            <div className="col-span-2 md:col-span-1 md:col-start-2 md:row-start-1">
              <LineLabel line={line} />
            </div>
            <div className="col-span-2 md:col-span-1 md:col-start-3 md:row-start-1">
              <LinePeople line={line} people={people} />
            </div>
            <div className="col-span-2 md:col-span-1 md:col-start-4 md:row-start-1">
              <LineToday line={line} />
            </div>
          </li>
        ))}
      </ul>
      {initialLines.length > 0 && <p className="mt-2 text-[12px] leading-4 text-ink-3">Lines switched on automatically when first seen: {initialLines.join(", ")}.</p>}
    </div>
  );
}

// ----------------------------------------------------------------------------------------- Fields

function NumberSetting({ settingKey, value, min, max, unit }: { settingKey: CallsNumberSetting; value: number; min: number; max: number; unit: string }) {
  const { pending, run } = useAction();
  const [draft, setDraft] = useState(String(value));
  const changed = draft !== String(value);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setCallsNumberSetting(settingKey, Number(draft)), "Saved");
      }}
    >
      <div className="w-28">
        <Input type="number" inputMode="numeric" min={min} max={max} step={1} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`${unit}, ${min} to ${max}`} className="font-mono tnum" />
      </div>
      <span className="text-[13px] text-ink-3">{unit}</span>
      {changed && (
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      )}
    </form>
  );
}

function DnyNumbers({ numbers }: { numbers: string[] }) {
  const { pending, run } = useAction();
  const [text, setText] = useState(numbers.join("\n"));
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        // The field then shows the numbers as stored ("+912212345678"), so "Save numbers" goes away.
        run(
          () => setDnyNumbers(text),
          (d) => `${d?.count ?? 0} number${d?.count === 1 ? "" : "s"} saved`,
          (r) => (r.ok ? setText((r.data?.numbers ?? []).join("\n")) : setError(r.error)),
        );
      }}
    >
      <Textarea id="dny-numbers" aria-label="Other DNY numbers, one per line" aria-describedby={error ? "dny-numbers-error" : undefined} aria-invalid={error ? true : undefined} value={text} onChange={(e) => setText(e.target.value)} rows={4} className={clsx("min-h-[96px] bg-sheet", error && "border-signal")} placeholder="+91 22 1234 5678" />
      {error && (
        <p id="dny-numbers-error" role="alert" className="text-[12px] leading-4 text-signal">
          {error}
        </p>
      )}
      {text !== numbers.join("\n") && (
        <Button type="submit" size="sm" variant="primary" className="self-start" disabled={pending}>
          {pending ? "Saving…" : "Save numbers"}
        </Button>
      )}
    </form>
  );
}

function Reread({ rereads, nowIso }: { rereads: PhoneCallsAdmin["rereads"]; nowIso: string }) {
  const { pending, run } = useAction();
  const today = istDate(nowIso);
  const [day, setDay] = useState("");
  const min = ymdMinus(today, 14);
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (day) run(() => requestReread(day), `Callyzer is read for ${day} again on the next runs`, (r) => r.ok && setDay(""));
        }}
      >
        <div className="w-44">
          <Input type="date" value={day} min={min} max={today} onChange={(e) => setDay(e.target.value)} aria-label="Day to read again" />
        </div>
        <Button type="submit" size="sm" disabled={!day || pending}>
          {pending ? "Asking…" : "Read again"}
        </Button>
      </form>
      {rereads.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {rereads.slice(0, 6).map((r) => (
            <li key={r.day}>
              <Chip tone={r.done_at ? "neutral" : "slate"} mono>
                {formatDayIst(`${r.day}T12:00:00+05:30`)}
                <span className="font-sans font-normal">{r.done_at ? ` · read ${formatTimeIst(r.done_at)}` : " · waiting"}</span>
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------------------- The card

export function PhoneCallsSettings({ data, nowIso }: { data: PhoneCallsAdmin; nowIso: string }) {
  const { pending, run } = useAction();
  const now = new Date(nowIso);
  const chip = statusChip(data);
  // The switch and the lines below already say "paused" and "no line is on".
  const problems = feedProblems(data.feed, { isAdmin: true, capMinutes: data.settings.maxAudioMinutesPerDay, now }).filter((p) => p.key !== "paused" && p.key !== "no_lines");
  const s = data.settings;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink-2">
        <Chip tone={chip.tone}>{chip.label}</Chip>
        <span>
          Callyzer checked <RelativeTime iso={data.feed?.lastPollOkAt ?? data.state.lastPollOkAt} nowIso={nowIso} />
        </span>
        <span className="tnum">
          Transcribed today <span className="font-mono text-ink">{data.feed?.minutesToday ?? 0}</span> / <span className="font-mono">{s.maxAudioMinutesPerDay}</span> min
        </span>
        {data.copiesFailed > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-signal tnum">
              Copies failed today or yesterday: <span className="font-mono">{data.copiesFailed}</span>
            </span>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => retryFailedCopies(), (d) => `${d?.count ?? 0} put back in the queue`)}>
              <ArrowClockwise size={14} aria-hidden="true" />
              Retry
            </Button>
          </span>
        )}
      </div>
      {problems.map((p) => (
        <InlineNote key={p.key} tone={p.tone === "signal" ? "signal" : "neutral"}>
          {p.text}
        </InlineNote>
      ))}

      <div>
        <FormRow label="Phone calls" hint="Paused, nothing is read from Callyzer. Deleting calls that are not work calls and old recordings goes on.">
          <PauseSwitch paused={s.paused} initialLines={s.initialLines} lines={data.lines} />
        </FormRow>
        <FormRow label="Phone lines" hint="DNY's phones as Callyzer reports them. Only lines that are on are analysed, from the moment they were switched on.">
          <LinesList lines={data.lines} people={data.people} initialLines={s.initialLines} nowIso={nowIso} />
        </FormRow>
        <FormRow label="Shortest call" hint="Shorter calls (and missed ones) are counted, never analysed.">
          <NumberSetting settingKey="calls_min_duration_sec" value={s.minDurationSec} min={15} max={600} unit="seconds" />
        </FormRow>
        <FormRow label="Longest call" hint="Longer calls are counted, never analysed.">
          <NumberSetting settingKey="calls_max_minutes" value={s.maxMinutes} min={30} max={240} unit="minutes" />
        </FormRow>
        <FormRow label="Daily transcription limit" hint="Audio minutes per day (IST), retries included. Past it, calls wait until tomorrow.">
          <NumberSetting settingKey="calls_max_audio_minutes_per_day" value={s.maxAudioMinutesPerDay} min={10} max={2000} unit="minutes" />
        </FormRow>
        <FormRow label="Routine claim timeout" hint="A call the routine took and did not finish goes back to the queue after this.">
          <NumberSetting settingKey="calls_claim_timeout_minutes" value={s.claimTimeoutMinutes} min={10} max={60} unit="minutes" />
        </FormRow>
        <FormRow label="Decision window" hint="A call the routine was not sure about is deleted this long after, unless someone decides.">
          <NumberSetting settingKey="calls_decision_hours" value={s.decisionHours} min={4} max={168} unit="hours" />
        </FormRow>
        <FormRow label="Other DNY numbers" hint="One per line, such as office landlines. Calls with them count as internal and are never analysed. The phone lines themselves are known already.">
          <DnyNumbers numbers={s.dnyNumbers} />
        </FormRow>
        <FormRow label="Deepgram" hint="The transcription service. Recordings are sent to it as one-time links.">
          <div className="flex items-center gap-2">
            <Switch checked={s.mipOptOut} disabled={pending} label="Don't let Deepgram use recordings to improve its models" onCheckedChange={(on) => run(() => setDeepgramOptOut(on), on ? "Recordings are opted out of Deepgram's model training" : "Deepgram may use recordings to improve its models")} />
            <span className="text-[14px] text-ink">Don&apos;t let Deepgram use recordings to improve its models</span>
          </div>
        </FormRow>
        <FormRow label="Night reading" hint="How often Callyzer is read between 23:30 and 08:30 IST.">
          <NativeSelect aria-label="Night reading" value={String(s.nightPollMinutes)} disabled={pending} onChange={(e) => run(() => setCallsNumberSetting("calls_night_poll_minutes", Number(e.target.value)), "Saved")} className="w-auto min-w-[200px] bg-sheet">
            {[2, 10, 20, 30].map((m) => (
              <option key={m} value={m}>
                {m === 2 ? "Every 2 minutes (as by day)" : `Every ${m} minutes`}
              </option>
            ))}
            {![2, 10, 20, 30].includes(s.nightPollMinutes) && <option value={s.nightPollMinutes}>Every {s.nightPollMinutes} minutes</option>}
          </NativeSelect>
        </FormRow>
        <FormRow label="Read a day again" hint="For recordings that reached Callyzer late. Up to 14 days back.">
          <Reread rereads={data.rereads} nowIso={nowIso} />
        </FormRow>
      </div>

      <div className="border-t border-hairline pt-4">
        <h3 className="label-xs mb-2">Recent not-work calls</h3>
        {data.recentNotWork.length === 0 ? (
          <p className="text-[13px] text-ink-3">None yet.</p>
        ) : (
          <ol className="divide-y divide-hairline text-[13px]">
            {data.recentNotWork.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                <span className="w-[132px] shrink-0 font-mono text-[12px] text-ink tnum">{c.masked}</span>
                <span className="min-w-0 flex-1 text-ink-2">
                  {c.lineName} · {SKIP_WORDS[c.code ?? ""] ?? "Deleted"}
                  {c.by && <span className="text-ink-3"> · by {BY_WORDS[c.by] ?? c.by}</span>}
                </span>
                <span className="text-[12px] text-ink-3 tnum">{c.happenedAt ? formatCallWhen(c.happenedAt, now) : ""}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-hairline pt-4">
        <h3 className="label-xs mb-2">How long calls take (7 days)</h3>
        {data.latencyCalls === 0 ? (
          <p className="text-[13px] text-ink-3">No client or vendor call has a sheet in the last 7 days.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3">
                <th className="py-1 font-medium">Step</th>
                <th className="py-1 pl-3 text-right font-medium whitespace-nowrap">Typical</th>
                <th className="py-1 pl-3 text-right font-medium whitespace-nowrap">Slowest 5%</th>
                <th className="hidden py-1 pl-3 text-right font-medium sm:table-cell">Calls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {data.latency.map((row) => (
                <tr key={row.key} className={row.key === "total" ? "font-medium text-ink" : "text-ink-2"}>
                  <td className="py-1.5">{row.label}</td>
                  <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap tnum">{formatSpan(row.p50)}</td>
                  <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap tnum">{formatSpan(row.p95)}</td>
                  <td className="hidden py-1.5 pl-3 text-right font-mono text-ink-3 tnum sm:table-cell">{row.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
