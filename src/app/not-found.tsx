import Link from "next/link";

// The page does not exist (or the signed-in person may not see it). Plain words, one way out.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center">
        <p className="text-[17px] font-semibold tracking-[-0.01em] text-ink">Call to Action</p>
        <p className="mt-8 font-serif text-[26px] leading-[1.25] tracking-[-0.01em] text-ink text-balance sm:text-[30px]">There is nothing at this address.</p>
        <p className="mt-3 text-[15px] leading-[22px] text-ink-2">The link may be old, or the meeting may have been removed.</p>
        <Link href="/meetings" className="mt-6 inline-flex h-11 w-fit items-center rounded-chip bg-ink px-4 text-[14px] font-medium text-sheet">
          Go to meetings
        </Link>
      </div>
    </main>
  );
}
