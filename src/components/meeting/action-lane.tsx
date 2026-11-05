"use client";

import clsx from "clsx";
import { ArrowsLeftRight, DotsThree, PencilSimple, Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { assignItem, type DismissReason, dismissItem, editItem, moveItemLane, restoreItem, setItemDone, setItemDue } from "@/app/(app)/meetings/[id]/actions";
import type { ActionItemRow, PersonSummary } from "@/lib/data/types";
import { daysUntil, formatShortDate, relativeDue } from "@/lib/format";
import { recordingUrl } from "@/lib/ui/evidence";
import { type LaneKey, needsCheck, needsReview } from "@/lib/ui/lanes";
import type { Attendee } from "@/lib/ui/participants";
import { firstName } from "@/lib/ui/text";
import { Button } from "@/components/ui/button";
import { Chip, PriorityDot, SectionLabel } from "@/components/ui/chip";
import { Input, Textarea } from "@/components/ui/fields";
import { Checkbox, Dialog, DialogContent, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { QuietLine } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { EvidencePill } from "./evidence";
import { EvidenceQuote } from "./evidence-quote";

// One ownership lane: header with count, open rows, the collapsed "Needs review" tray for rows the
// model was unsure about, and "Done · n" at the end. Every change is optimistic and rolls back with
// a plain message if the server says no.

export interface LaneProps {
  lane: LaneKey;
  title: string;
  items: ActionItemRow[];
  people: PersonSummary[];
  contacts: Attendee[];
  tldvUrl: string | null;
  timestampParam: string | null;
  /** Today's date in ISO, from the server, so relative dates are the same on both sides. */
  today: string;
  emptyText: string;
}

type Patch = Partial<Pick<ActionItemRow, "status" | "owner_name" | "owner_email" | "due_date" | "title" | "details" | "owed_by">>;
type Act = { id: string; patch: Patch };

export function ActionLane({ lane, title, items, people, contacts, tldvUrl, timestampParam, today, emptyText }: LaneProps) {
  const router = useRouter();
  const toast = useToast();
  const [optimistic, apply] = useOptimistic(items, (state: ActionItemRow[], act: Act) => state.map((i) => (i.id === act.id ? { ...i, ...act.patch } : i)));
  const [, start] = useTransition();
  const now = new Date(today);

  /** Apply a patch at once, run the action, and let the server's revalidation settle the truth. */
  const mutate = (id: string, patch: Patch, run: () => Promise<{ ok: boolean; error?: string }>, after?: (ok: boolean) => void) =>
    start(async () => {
      apply({ id, patch });
      const result = await run();
      if (!result.ok) toast({ message: `Couldn't save — restored. ${result.error ?? ""}`.trim(), tone: "signal" });
      after?.(result.ok);
      router.refresh();
    });

  const visible = optimistic.filter((i) => i.status !== "dropped" && i.status !== "superseded");
  const done = visible.filter((i) => i.status === "done");
  const open = visible.filter((i) => i.status !== "done" && !needsReview(i));
  const review = visible.filter((i) => i.status !== "done" && needsReview(i));
  const count = open.length + review.length;

  const rowProps = { people, contacts, tldvUrl, timestampParam, now, mutate, lane };

  return (
    <section id={`lane-${lane}`} aria-labelledby={`lane-${lane}-title`} className="scroll-mt-20">
      <SectionLabel id={`lane-${lane}-title`} count={count} className={lane === "dny" ? "text-bottle" : lane === "client" ? "text-sienna" : "text-slate"}>
        {title}
      </SectionLabel>
      {count === 0 && done.length === 0 && <QuietLine>{emptyText}</QuietLine>}
      <ul className="mt-1 divide-y divide-hairline">
        {open.map((item) => (
          <ActionRow key={item.id} item={item} {...rowProps} />
        ))}
      </ul>
      {review.length > 0 && (
        <details className="group mt-2 rounded-card bg-inset">
          <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 text-[13px] font-medium text-ink-2 select-none [&::-webkit-details-marker]:hidden">
            <span className="transition-transform duration-150 group-open:rotate-90">›</span>
            Needs review ({review.length})
            <span className="font-normal text-ink-3">· the model was unsure or the quote did not match</span>
          </summary>
          <ul className="divide-y divide-hairline border-t border-hairline px-1">
            {review.map((item) => (
              <ActionRow key={item.id} item={item} {...rowProps} inTray />
            ))}
          </ul>
        </details>
      )}
      {done.length > 0 && (
        <details className="group mt-2">
          <summary className="flex h-9 cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-ink-3 select-none [&::-webkit-details-marker]:hidden">
            <span className="transition-transform duration-150 group-open:rotate-90">›</span>
            Done · <span className="font-mono tnum">{done.length}</span>
          </summary>
          <ul className="divide-y divide-hairline border-t border-hairline">
            {done.map((item) => (
              <ActionRow key={item.id} item={item} {...rowProps} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------- Row

interface RowProps {
  item: ActionItemRow;
  lane: LaneKey;
  people: PersonSummary[];
  contacts: Attendee[];
  tldvUrl: string | null;
  timestampParam: string | null;
  now: Date;
  inTray?: boolean;
  mutate: (id: string, patch: Patch, run: () => Promise<{ ok: boolean; error?: string }>, after?: (ok: boolean) => void) => void;
}

function ActionRow({ item, people, contacts, tldvUrl, timestampParam, now, inTray, mutate }: RowProps) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const done = item.status === "done";
  const check = !done && needsCheck(item);
  const [verb, ...rest] = item.title.split(" ");
  const overdue = item.due_date ? daysUntil(item.due_date, now) < 0 : false;

  const toggleDone = (next: boolean) =>
    mutate(item.id, { status: next ? "done" : "open" }, () => setItemDone(item.id, next), (ok) => {
      if (ok && next) toast({ message: "Marked done", undo: () => setItemDone(item.id, false) });
    });

  return (
    <li className={clsx("group/row flex flex-wrap items-start gap-x-2 py-1.5 md:flex-nowrap", inTray && "px-2")}>
      <Checkbox checked={done} onCheckedChange={toggleDone} label={`${done ? "Reopen" : "Mark done"}: ${item.title}`} className="-ml-3 md:-ml-2" />

      <div className="min-w-0 flex-1 py-2.5 md:py-1.5">
        {editing ? (
          <EditForm item={item} onDone={() => setEditing(false)} mutate={mutate} />
        ) : (
          <>
            <p className={clsx("text-[15px] leading-[22px] lg:text-[14px] lg:leading-[20px]", done ? "strike-in text-ink-3" : "text-ink")}>
              <span className={clsx(!done && "font-medium", check && "underline decoration-dashed decoration-strong underline-offset-[3px]")} title={check ? "Model is unsure — check the quote" : undefined}>
                {verb}
              </span>
              {rest.length > 0 && <span className={check ? "underline decoration-dashed decoration-strong underline-offset-[3px]" : undefined}> {rest.join(" ")}</span>}
              {item.edited_at && <PencilSimple size={12} aria-label="Edited by a person" className="ml-1.5 inline text-ink-3" />}
            </p>
            {item.details && <p className="mt-0.5 text-[13px] leading-[18px] text-ink-2">{item.details}</p>}
          </>
        )}
        <div className="evidence-inline mt-2">
          <EvidenceQuote seconds={item.evidence_ts_sec} speaker={item.evidence_speaker} quote={item.evidence_quote} verified={item.evidence_verified} />
        </div>
      </div>

      <div className="flex basis-full flex-wrap items-center gap-1.5 pb-2 pl-8 md:basis-auto md:pt-1.5 md:pb-0 md:pl-0">
        {check && <Chip tone="neutral">Check</Chip>}
        <PriorityDot priority={item.priority} />
        <OwnerPill item={item} people={people} contacts={contacts} disabled={done} mutate={mutate} />
        <DueChip item={item} now={now} overdue={overdue} disabled={done} mutate={mutate} />
        <EvidencePill seconds={item.evidence_ts_sec} speaker={item.evidence_speaker} quote={item.evidence_quote} recordingHref={recordingUrl(tldvUrl, item.evidence_ts_sec, timestampParam)} verified={item.evidence_verified} />
        <Menu>
          <MenuTrigger asChild>
            <button type="button" aria-label={`More for: ${item.title}`} className="inline-flex size-9 items-center justify-center rounded-chip text-ink-3 transition-colors duration-150 hover:bg-raised hover:text-ink md:size-7 md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100">
              <DotsThree size={20} weight="bold" />
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => setEditing(true)}>
              <PencilSimple size={16} aria-hidden="true" /> Edit
            </MenuItem>
            <MenuItem onSelect={() => mutate(item.id, { owed_by: item.owed_by === "dny" ? "client" : "dny" }, () => moveItemLane(item.id))}>
              <ArrowsLeftRight size={16} aria-hidden="true" /> Move to {item.owed_by === "dny" ? "Client owes" : "DNY owes"}
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={() => setDismissing(true)}>
              <Trash size={16} aria-hidden="true" /> Dismiss…
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <DismissDialog open={dismissing} onOpenChange={setDismissing} item={item} mutate={mutate} />
    </li>
  );
}

function EditForm({ item, onDone, mutate }: { item: ActionItemRow; onDone: () => void; mutate: RowProps["mutate"] }) {
  const [title, setTitle] = useState(item.title);
  const [details, setDetails] = useState(item.details);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (t.length < 3) return;
        mutate(item.id, { title: t, details: details.trim() }, () => editItem(item.id, { title: t, details }));
        onDone();
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" maxLength={140} autoFocus className="bg-sheet" />
      <Textarea value={details} onChange={(e) => setDetails(e.target.value)} aria-label="Details" maxLength={1000} className="min-h-[64px] bg-sheet font-sans text-[14px]" />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={title.trim().length < 3}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function OwnerPill({ item, people, contacts, disabled, mutate }: { item: ActionItemRow; people: PersonSummary[]; contacts: Attendee[]; disabled?: boolean; mutate: RowProps["mutate"] }) {
  const label = firstName(item.owner_name) ?? item.owner_email?.split("@")[0] ?? null;
  const side = item.owed_by === "client" ? "sienna" : "bottle";
  const assign = (owner: { name: string | null; email: string | null } | null) => mutate(item.id, { owner_name: owner?.name ?? null, owner_email: owner?.email ?? null }, () => assignItem(item.id, owner));
  const current = item.owner_email ?? item.owner_name;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label ? `Owner: ${item.owner_name ?? item.owner_email}. Change` : "Unassigned. Assign an owner"}
          className={clsx(
            "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium leading-none whitespace-nowrap transition-colors duration-150 disabled:opacity-60",
            label ? (side === "sienna" ? "bg-sienna-tint text-sienna hover:bg-sienna-tint/70" : "bg-bottle-tint text-bottle hover:bg-bottle-tint/70") : "dashed-chip hover:border-ink-2 hover:text-ink-2",
          )}
        >
          {label ?? "Unassigned"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[320px] overflow-y-auto p-1.5">
        <OwnerGroup title="DNY" options={people.map((p) => ({ key: p.email, name: p.full_name, email: p.email, hint: p.dept ?? "" }))} current={current} onPick={assign} />
        {contacts.length > 0 && <OwnerGroup title="Client" options={contacts.map((c) => ({ key: c.email ?? c.name ?? "", name: c.name ?? c.email ?? "Attendee", email: c.email, hint: c.email && c.name ? c.email : "" }))} current={current} onPick={assign} />}
        <PopoverClose asChild>
          <button type="button" onClick={() => assign(null)} className="mt-1 flex h-9 w-full items-center rounded-[6px] px-2 text-[13px] text-ink-3 hover:bg-raised">
            Clear owner
          </button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

function OwnerGroup({ title, options, current, onPick }: { title: string; options: Array<{ key: string; name: string; email: string | null; hint: string }>; current: string | null; onPick: (o: { name: string; email: string | null }) => void }) {
  return (
    <div className="mb-1">
      <p className="px-2 pt-1.5 pb-1 text-[11px] font-semibold text-ink-3">{title}</p>
      {options.map((o) => (
        <PopoverClose asChild key={o.key}>
          <button type="button" onClick={() => onPick({ name: o.name, email: o.email })} className={clsx("flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] hover:bg-raised", (o.email && o.email === current) || o.name === current ? "bg-inset text-ink" : "text-ink")} aria-current={(o.email && o.email === current) || o.name === current ? "true" : undefined}>
            <span className="flex-1 truncate">{o.name}</span>
            {o.hint && <span className="truncate text-[11px] text-ink-3">{o.hint}</span>}
          </button>
        </PopoverClose>
      ))}
    </div>
  );
}

function DueChip({ item, now, overdue, disabled, mutate }: { item: ActionItemRow; now: Date; overdue: boolean; disabled?: boolean; mutate: RowProps["mutate"] }) {
  const set = (date: string | null) => mutate(item.id, { due_date: date }, () => setItemDue(item.id, date));
  const plus = (days: number) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={item.due_date ? `Due ${formatShortDate(item.due_date)}, ${relativeDue(item.due_date, now)}. Change` : "No date. Set a due date"}
          className={clsx(
            "inline-flex h-6 items-center gap-1 rounded-chip px-2 text-[12px] font-medium leading-none whitespace-nowrap transition-colors duration-150 disabled:opacity-60",
            item.due_date ? (overdue ? "bg-signal-tint text-signal" : "bg-inset text-ink-2 hover:bg-raised") : "dashed-chip hover:border-ink-2 hover:text-ink-2",
          )}
        >
          {item.due_date ? (
            <>
              <span className="font-mono tnum">{formatShortDate(item.due_date)}</span>
              <span className="hidden font-normal opacity-80 sm:inline">· {relativeDue(item.due_date, now)}</span>
            </>
          ) : (
            "No date"
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px]">
        <label className="text-[12px] font-medium text-ink" htmlFor={`due-${item.id}`}>
          Due date
        </label>
        <Input id={`due-${item.id}`} type="date" defaultValue={item.due_date ?? ""} onChange={(e) => e.target.value && set(e.target.value)} className="mt-1 h-9 bg-sheet" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            ["Tomorrow", plus(1)],
            ["In 3 days", plus(3)],
            ["In a week", plus(7)],
          ].map(([label, date]) => (
            <PopoverClose asChild key={label}>
              <Button size="sm" onClick={() => set(date)}>
                {label}
              </Button>
            </PopoverClose>
          ))}
          {item.due_date && (
            <PopoverClose asChild>
              <Button size="sm" variant="ghost" onClick={() => set(null)}>
                Clear
              </Button>
            </PopoverClose>
          )}
        </div>
        {item.due_phrase && <p className="mt-2 text-[12px] text-ink-3">Said: “{item.due_phrase}”</p>}
      </PopoverContent>
    </Popover>
  );
}

const REASONS: Array<{ key: DismissReason; label: string }> = [
  { key: "not_said", label: "This was not said" },
  { key: "duplicate", label: "Duplicate of another item" },
  { key: "too_vague", label: "Too vague to act on" },
  { key: "other", label: "Other" },
];

function DismissDialog({ open, onOpenChange, item, mutate }: { open: boolean; onOpenChange: (o: boolean) => void; item: ActionItemRow; mutate: RowProps["mutate"] }) {
  const toast = useToast();
  const [reason, setReason] = useState<DismissReason>("not_said");
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Dismiss this item?" description="It leaves the sheet; the reason helps the next sheets get better.">
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Reason</legend>
          {REASONS.map((r) => (
            <label key={r.key} className="flex h-10 items-center gap-2.5 rounded-chip px-2 text-[14px] text-ink hover:bg-raised">
              <input type="radio" name={`dismiss-${item.id}`} checked={reason === r.key} onChange={() => setReason(r.key)} className="accent-[var(--ink)]" />
              {r.label}
            </label>
          ))}
        </fieldset>
        {reason === "other" && <Input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Reason" placeholder="Say why, briefly" className="mt-2" />}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onOpenChange(false);
              mutate(item.id, { status: "dropped" }, () => dismissItem(item.id, reason, note), (ok) => {
                if (ok) toast({ message: "Item dismissed", undo: () => restoreItem(item.id) });
              });
            }}
          >
            Dismiss
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
