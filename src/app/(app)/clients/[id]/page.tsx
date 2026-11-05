import { ArrowLeft, PencilSimple } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getClientPage } from "@/lib/data/clients";
import { formatDateTimeIst, timeAgo } from "@/lib/format";
import { statusTone, statusWord } from "@/lib/ui/status";
import { ClientDialog } from "@/components/clients/client-dialog";
import { ItemLine } from "@/components/meeting/item-line";
import { Button } from "@/components/ui/button";
import { Chip, StatusDot } from "@/components/ui/chip";
import { ListGroup } from "@/components/ui/page-header";
import { QuietLine } from "@/components/ui/states";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  await requireUser();
  const data = await getClientPage(id).catch(() => null);
  return { title: data?.client.name ?? "Client" };
}

// One client's history: open items across meetings in two lanes, then the meetings with their minutes.
export default async function ClientPage({ params }: { params: Params }) {
  const { id } = await params;
  const { isAdmin } = await requireUser();
  const data = await getClientPage(id);
  if (!data) notFound();
  const { client, meetings, items } = data;
  const now = new Date();
  const dny = items.filter((i) => i.owed_by === "dny" || i.owed_by === "both");
  const theirs = items.filter((i) => i.owed_by === "client" || i.owed_by === "both");

  return (
    <div className="mx-auto max-w-[880px]">
      <Link href="/clients" className="mb-3 inline-flex h-8 items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} aria-hidden="true" />
        Clients
      </Link>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-[26px] leading-[1.2] tracking-[-0.01em] text-ink">{client.name}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
            <Chip tone={client.status === "active" ? "bottle" : client.status === "onboarding" ? "slate" : "neutral"}>{client.status}</Chip>
            <span className="font-mono text-[12px]">{client.domains.join(", ") || "no domains"}</span>
            {client.contact_emails.length > 0 && <span className="font-mono text-[12px]">· {client.contact_emails.join(", ")}</span>}
            <span>
              · {meetings.length} meeting{meetings.length === 1 ? "" : "s"}
            </span>
          </p>
          {client.notes && <p className="mt-2 max-w-[70ch] text-[14px] leading-[20px] text-ink-2">{client.notes}</p>}
        </div>
        {isAdmin && (
          <ClientDialog
            client={client}
            trigger={
              <Button>
                <PencilSimple size={16} aria-hidden="true" />
                Edit
              </Button>
            }
          />
        )}
      </header>

      <div className="flex flex-col gap-4">
        <ListGroup title="DNY owes" count={dny.length}>
          {dny.length ? dny.map((i) => <ItemLine key={i.id} item={i} now={now} context={{ href: `/meetings/${i.meeting_id}`, label: i.meeting_title ?? formatDateTimeIst(i.meeting_happened_at) }} />) : <QuietLine className="px-4">Nothing open for DNY.</QuietLine>}
        </ListGroup>
        <ListGroup title="Client owes" count={theirs.length}>
          {theirs.length ? theirs.map((i) => <ItemLine key={`c-${i.id}`} item={i} now={now} context={{ href: `/meetings/${i.meeting_id}`, label: i.meeting_title ?? formatDateTimeIst(i.meeting_happened_at) }} />) : <QuietLine className="px-4">Nothing owed by the client.</QuietLine>}
        </ListGroup>

        <ListGroup title="Meetings" count={meetings.length}>
          {meetings.length === 0 && <QuietLine className="px-4">No recorded meetings with this client yet.</QuietLine>}
          {meetings.map((m) => (
            <li key={m.id}>
              <Link href={`/meetings/${m.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-raised lg:min-h-12">
                <StatusDot tone={statusTone(m.process_status)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">{m.headline ?? m.title ?? "Untitled meeting"}</p>
                  <p className="truncate text-[12px] text-ink-3">
                    {m.headline ? m.title : statusWord(m.process_status)} · {formatDateTimeIst(m.happened_at)}
                  </p>
                </div>
                <span className="shrink-0 text-[12px] text-ink-3 tnum">{timeAgo(m.happened_at, now)}</span>
              </Link>
            </li>
          ))}
        </ListGroup>
      </div>
    </div>
  );
}
