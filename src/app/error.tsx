"use client";

import { useEffect } from "react";

// A page outside the shell failed (sign-in, denied). Real reason, one retry.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center">
        <p className="text-[17px] font-semibold tracking-[-0.01em] text-ink">Call to Action</p>
        <div role="alert" className="card mt-8 border-l-[3px] border-l-signal p-5">
          <p className="text-[15px] font-semibold text-ink">This page could not be loaded</p>
          <p className="mt-1 text-[14px] leading-[20px] text-ink-2 break-words">{error.message || "The server did not answer in time."}</p>
          <button type="button" onClick={() => reset()} className="mt-4 inline-flex h-10 items-center rounded-chip border border-strong bg-sheet px-3.5 text-[14px] font-medium text-ink hover:bg-raised">
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
