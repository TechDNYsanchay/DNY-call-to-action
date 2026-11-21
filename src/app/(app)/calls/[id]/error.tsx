"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

// A call page that failed to load. It sits inside the call's layout, so a recording that was playing keeps
// playing, and with the player card gone the mini-player docks at the bottom at every screen size to pause it;
// "Try again" fetches and renders the page again.
export default function CallError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const reason = error instanceof Error && error.message ? error.message : "The server did not answer in time.";
  return (
    <div className="mx-auto max-w-[880px]">
      <ErrorState
        title="This call could not be loaded"
        reason={reason}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => retry()}>
              Try again
            </Button>
            <Link href="/calls" className={buttonClass("ghost")}>
              Back to calls
            </Link>
          </div>
        }
      />
    </div>
  );
}
