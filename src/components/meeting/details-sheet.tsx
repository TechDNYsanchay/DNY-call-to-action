"use client";

import { Info } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, SideSheetContent } from "@/components/ui/primitives";

/** Tablet and phone: the context rail's content behind a "Details" button, in a right-side sheet. */
export function DetailsSheet({ children }: { children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <Info size={16} aria-hidden="true" />
          Details
        </Button>
      </DialogTrigger>
      <SideSheetContent title="Details">{children}</SideSheetContent>
    </Dialog>
  );
}
