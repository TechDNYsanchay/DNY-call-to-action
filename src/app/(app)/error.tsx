"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

// Catches a failed page inside the shell: the real message, and a retry that re-renders the segment.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-[880px]">
      <ErrorState
        title="This page could not be loaded"
        reason={error.message || "The server did not answer in time."}
        action={
          <Button variant="secondary" onClick={() => reset()}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
