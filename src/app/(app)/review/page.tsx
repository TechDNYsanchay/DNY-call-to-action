import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { listClientOptions } from "@/lib/data/clients";
import { listReviewQueue } from "@/lib/data/meetings";
import { ReviewRow } from "@/components/review/review-row";
import { RefreshOnFocus } from "@/components/shell/refresh-on-focus";
import { ListGroup, PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Needs review" };

// Meetings the model could not place, with its reason, and recent sales meetings as quiet rows in
// case one of them is really a client.
export default async function ReviewPage() {
  await requireUser();
  const [{ undecided, sales }, clients] = await Promise.all([listReviewQueue(), listClientOptions()]);

  return (
    <div className="mx-auto max-w-[880px]">
      <RefreshOnFocus />
      <PageHeader title="Needs review" description="One tap decides. A person's answer is final." />
      {undecided.length === 0 ? (
        <EmptyState title="Nothing to decide.">When the model is unsure whether a recording is a client meeting, it appears here with its reason.</EmptyState>
      ) : (
        <ListGroup title="Needs your decision" count={undecided.length}>
          {undecided.map((m) => (
            <ReviewRow key={m.id} meeting={m} clients={clients} />
          ))}
        </ListGroup>
      )}
      {sales.length > 0 && (
        <ListGroup title="Sales meetings, handed to the sales agent" count={sales.length} quiet className="mt-4">
          {sales.map((m) => (
            <ReviewRow key={m.id} meeting={m} clients={clients} quiet />
          ))}
        </ListGroup>
      )}
    </div>
  );
}
