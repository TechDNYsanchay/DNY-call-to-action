import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { SignOutButton } from "@/app/auth/signout/sign-out-button";
import { requireUser } from "@/lib/auth/require-user";
import { getOpsData } from "@/lib/data/ops";
import { listAllPeople } from "@/lib/data/people";
import { formatDateTimeIst, timeAgo } from "@/lib/format";
import { MAX_BACKFILL_DAYS } from "@/lib/ingest/backfill";
import { PROMPT_VERSION } from "@/lib/sheet/schema";
import { statusWord } from "@/lib/ui/status";
import { BackfillForm, PipelineToggle, ReplayForm } from "@/components/settings/pipeline-controls";
import { AddPersonForm, TeamTable } from "@/components/settings/team";
import { Chip } from "@/components/ui/chip";
import { FormRow } from "@/components/ui/fields";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Settings" };

function Card({ title, description, children, id }: { title: string; description?: string; children: React.ReactNode; id: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="card p-5">
      <h2 id={`${id}-title`} className="text-[15px] font-semibold text-ink">
        {title}
      </h2>
      {description && <p className="mt-0.5 text-[13px] leading-[18px] text-ink-3">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "signal" | "bottle" }) {
  return (
    <div className="rounded-card border border-hairline p-3">
      <p className="text-[12px] leading-4 text-ink-3">{label}</p>
      <p className={`mt-1 font-mono text-[18px] leading-6 font-medium tnum ${tone === "signal" ? "text-signal" : tone === "bottle" ? "text-bottle" : "text-ink"}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[12px] text-ink-3">{sub}</p>}
    </div>
  );
}

// Admins: Team, Integrations & status, About. Members: a read-only "Your account" card.
export default async function SettingsPage() {
  const { person, isAdmin } = await requireUser();
  const now = new Date();
  const [people, ops] = isAdmin ? await Promise.all([listAllPeople(), getOpsData()]) : [null, null];

  return (
    <div className="mx-auto max-w-[960px]">
      <PageHeader title="Settings" description={isAdmin ? "Team, integrations and the pipeline" : "Your account"} />
      <div className="flex flex-col gap-4">
        <Card id="account" title="Your account">
          <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[160px_1fr]">
            <dt className="text-ink-3">Name</dt>
            <dd className="text-ink">{person.full_name}</dd>
            <dt className="text-ink-3">Email</dt>
            <dd className="font-mono text-[13px] text-ink">{person.email}</dd>
            <dt className="text-ink-3">Role</dt>
            <dd className="text-ink">{person.role === "admin" ? "Admin" : "Member"}</dd>
            {person.dept && (
              <>
                <dt className="text-ink-3">Department</dt>
                <dd className="text-ink">{person.dept}</dd>
              </>
            )}
          </dl>
          <div className="mt-4 border-t border-hairline pt-3 md:hidden">
            <SignOutButton className="h-11 w-full border border-strong bg-sheet text-ink hover:bg-raised">Sign out</SignOutButton>
          </div>
          {!isAdmin && <p className="mt-4 text-[13px] leading-[18px] text-ink-3">Only admins can change the team list and integrations. Ask tech@dnyhospitality.com if something needs changing.</p>}
        </Card>

        {isAdmin && people && ops && (
          <>
            <Card id="team" title="Team" description="Who can sign in. Adding someone creates their login at once; deactivating stops it within the hour.">
              <TeamTable people={people} selfEmail={person.email} />
              <div className="mt-5 border-t border-hairline pt-4">
                <h3 className="label-xs mb-3">Add a person</h3>
                <AddPersonForm />
              </div>
            </Card>

            <Card id="integrations" title="Integrations & status" description="tl;dv feeds meetings in; the Claude Code routine writes the sheets.">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Last tl;dv webhook" value={ops.lastWebhook ? timeAgo(ops.lastWebhook.received_at, now) : "none yet"} sub={ops.lastWebhook ? `${ops.lastWebhook.event} · ${formatDateTimeIst(ops.lastWebhook.received_at)}` : "Set the webhook URL in tl;dv to receive events"} />
                <Stat label="Last cron sync" value={ops.sync?.last_synced_at ? timeAgo(ops.sync.last_synced_at, now) : "never"} sub={ops.sync?.locked_until && new Date(ops.sync.locked_until) > now ? "a tick is running now" : "every 10 minutes"} />
                <Stat label="Failed in 24 h" value={String(ops.failedLast24h)} tone={ops.failedLast24h ? "signal" : undefined} sub={ops.failedLast24h ? "see Needs your decision in the inbox" : "nothing failed"} />
                <Stat label="Waiting for the routine" value={String(ops.countsByStatus.ready)} tone={ops.countsByStatus.ready ? "bottle" : undefined} sub={ops.oldestReadyAt ? `oldest ready ${timeAgo(ops.oldestReadyAt, now)}` : "queue is empty"} />
              </div>

              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Meetings by status">
                {(Object.keys(ops.countsByStatus) as Array<keyof typeof ops.countsByStatus>).map((s) => (
                  <li key={s}>
                    <Chip mono tone={s === "failed" ? "signal" : s === "needs_decision" ? "sienna" : s === "done" ? "bottle" : "neutral"}>
                      {ops.countsByStatus[s]} <span className="font-sans font-normal">{statusWord(s).toLowerCase()}</span>
                    </Chip>
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                <FormRow label="Pipeline" hint="Pause to stop handing meetings to the routine; intake keeps storing them.">
                  <PipelineToggle paused={ops.settings.pipeline_paused} />
                </FormRow>
                <FormRow label="Analysis" hint="Where the sheets come from.">
                  <p className="text-[14px] leading-[20px] text-ink-2">
                    Sheets are written by the Claude Code routine on DNY&apos;s Claude Max plan; it runs hourly and can be run now from{" "}
                    <a href="https://claude.ai/code/routines" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink underline decoration-strong underline-offset-2">
                      claude.ai/code/routines
                      <ArrowSquareOut size={13} aria-hidden="true" />
                    </a>
                    . Confidence threshold {Math.round(ops.settings.confidence_threshold * 100)}%, up to {ops.settings.max_per_run} meetings per run, {ops.settings.max_attempts} attempts before a meeting fails, claims released after {ops.settings.claim_timeout_minutes} minutes.
                  </p>
                </FormRow>
                <FormRow label="Replay a tl;dv meeting" hint="For testing, or when a webhook was missed.">
                  <ReplayForm />
                </FormRow>
                <FormRow label="Backfill" hint="Pull older recordings in. Clients should be in the list first so the rules can label them.">
                  <BackfillForm maxDays={MAX_BACKFILL_DAYS} />
                </FormRow>
              </div>

              <div className="mt-4 border-t border-hairline pt-4">
                <h3 className="label-xs mb-2">Recent pipeline events</h3>
                {ops.events.length === 0 ? (
                  <p className="text-[13px] text-ink-3">Nothing logged yet.</p>
                ) : (
                  <ol className="divide-y divide-hairline text-[13px]">
                    {ops.events.map((e) => (
                      <li key={e.id} className="flex gap-3 py-1.5">
                        <span className="w-[120px] shrink-0 font-mono text-[12px] text-ink-3 tnum">{formatDateTimeIst(e.created_at).slice(0, 16)}</span>
                        <span className={`w-14 shrink-0 text-[12px] ${e.level === "error" ? "text-signal" : e.level === "warn" ? "text-sienna" : "text-ink-3"}`}>{e.level}</span>
                        <span className="min-w-0 flex-1 text-ink-2">
                          <span className="text-ink">{e.step}</span> · {e.message}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </Card>

            <Card id="about" title="About">
              <dl className="grid gap-x-6 gap-y-2 font-mono text-[13px] tnum sm:grid-cols-[160px_1fr]">
                <dt className="text-ink-3">prompt version</dt>
                <dd className="text-ink">{PROMPT_VERSION}</dd>
                <dt className="text-ink-3">environment</dt>
                <dd className="text-ink">{process.env.VERCEL_ENV ?? process.env.NODE_ENV}</dd>
                <dt className="text-ink-3">region</dt>
                <dd className="text-ink">{process.env.VERCEL_REGION ?? "local"}</dd>
                <dt className="text-ink-3">retention</dt>
                <dd className="text-ink">{ops.settings.retention_months} months</dd>
              </dl>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
