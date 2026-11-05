import { Plus } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { listClients } from "@/lib/data/clients";
import { timeAgo } from "@/lib/format";
import { ClientDialog } from "@/components/clients/client-dialog";
import { CsvImport } from "@/components/clients/csv-import";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Clients" };

const STATUS_TONE = { active: "bottle", onboarding: "slate", churned: "neutral" } as const;

// Every client with what is open for DNY and when they were last met. Admins add, edit and import.
export default async function ClientsPage() {
  const { isAdmin } = await requireUser();
  const clients = await listClients();
  const now = new Date();

  return (
    <div className="mx-auto max-w-[880px]">
      <PageHeader
        title="Clients"
        description="Known domains and contacts make a recording a client meeting automatically"
        actions={
          isAdmin && (
            <ClientDialog
              trigger={
                <Button variant="primary">
                  <Plus size={16} aria-hidden="true" />
                  Add client
                </Button>
              }
            />
          )
        }
      />

      {clients.length === 0 ? (
        <EmptyState title="No clients yet.">{isAdmin ? "Add clients one by one, or paste a CSV below. Until then, every recording is classified by reading its transcript." : "An admin can add clients in this list."}</EmptyState>
      ) : (
        <section className="card overflow-hidden" aria-label="Clients">
          <div className="hidden grid-cols-[1fr_220px_90px_110px] gap-4 border-b border-hairline px-4 py-2.5 md:grid">
            <span className="label-xs">Client</span>
            <span className="label-xs">Domains</span>
            <span className="label-xs text-right">Open for DNY</span>
            <span className="label-xs text-right">Last meeting</span>
          </div>
          <ul className="divide-y divide-hairline">
            {clients.map((c) => (
              <li key={c.id}>
                <Link href={`/clients/${c.id}`} className="grid min-h-14 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 transition-colors duration-150 hover:bg-raised md:grid-cols-[1fr_220px_90px_110px] lg:min-h-12">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[15px] font-medium text-ink lg:text-[14px]">{c.name}</span>
                    {c.status !== "active" && <Chip tone={STATUS_TONE[c.status as keyof typeof STATUS_TONE] ?? "neutral"}>{c.status}</Chip>}
                  </span>
                  <span className="order-3 col-span-2 truncate font-mono text-[12px] text-ink-3 md:order-none md:col-span-1">{c.domains.join(", ") || (c.contact_emails.length ? `${c.contact_emails.length} contact${c.contact_emails.length === 1 ? "" : "s"}` : "no domains yet")}</span>
                  <span className={`text-right font-mono text-[13px] tnum ${c.openDny ? "text-bottle" : "text-ink-3"}`}>{c.openDny}</span>
                  <span className="hidden text-right text-[12px] text-ink-3 tnum md:block">{c.lastMeetingAt ? timeAgo(c.lastMeetingAt, now) : "—"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isAdmin && (
        <section className="card mt-6 p-5" aria-labelledby="csv-title">
          <h2 id="csv-title" className="text-[15px] font-semibold text-ink">
            Import from CSV
          </h2>
          <p className="mt-0.5 mb-4 text-[13px] leading-[18px] text-ink-3">Paste lines from a spreadsheet. You see what will be saved before anything is written.</p>
          <CsvImport />
        </section>
      )}
    </div>
  );
}
