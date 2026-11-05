"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { setItemDone } from "@/app/(app)/meetings/[id]/actions";
import { Checkbox } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

/** A done checkbox for lists outside the sheet (My actions, client page). Optimistic, with undo. */
export function QuickDone({ itemId, done, title }: { itemId: string; done: boolean; title: string }) {
  const router = useRouter();
  const toast = useToast();
  const [optimistic, setOptimistic] = useOptimistic(done);
  const [, start] = useTransition();

  const toggle = (next: boolean) =>
    start(async () => {
      setOptimistic(next);
      const result = await setItemDone(itemId, next);
      if (!result.ok) return toast({ message: `Couldn't save — restored. ${result.error}`, tone: "signal" });
      if (next) toast({ message: "Marked done", undo: () => setItemDone(itemId, false).then(() => router.refresh()) });
      router.refresh();
    });

  return <Checkbox checked={optimistic} onCheckedChange={toggle} label={`${optimistic ? "Reopen" : "Mark done"}: ${title}`} />;
}
