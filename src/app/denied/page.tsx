import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/app/auth/signout/sign-out-button";
import { currentPerson } from "@/lib/auth/require-user";
import { looksLikeEmail } from "@/lib/auth/sign-in";

export const metadata: Metadata = { title: "Not on the team list" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Where a signed-in account that is not on the team list lands. The callback already signed it out
// and passed the address; requireUser() sends people here while still signed in, so the sign-out
// button posts for real. Someone added to the list in the meantime goes straight in. The session and
// query reads happen at request time, so they sit behind Suspense and the chrome prerenders.
export default function DeniedPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center">
        <header>
          <p className="text-[17px] font-semibold tracking-[-0.01em] text-ink">Call to Action</p>
          <p className="mt-0.5 text-[13px] leading-[18px] text-ink-3">DNY Hospitality</p>
        </header>

        <section className="card mt-8 p-5 sm:p-6">
          <h1 className="font-serif text-[24px] leading-[1.25] tracking-[-0.01em] text-ink text-balance sm:text-[26px]">
            You&apos;re signed in, but not on the team list yet.
          </h1>
          <Suspense fallback={<DeniedCopy />}>
            <DeniedDetails searchParams={searchParams} />
          </Suspense>
          <p className="mt-3 text-[15px] leading-[22px] text-ink-2">
            Ask{" "}
            <a href="mailto:tech@dnyhospitality.com" className="text-ink underline decoration-strong underline-offset-2">
              tech@dnyhospitality.com
            </a>{" "}
            to add you to the team list, then sign in again.
          </p>
          <div className="mt-6 border-t border-hairline pt-4">
            <SignOutButton className="h-11 w-full border border-strong bg-sheet text-ink hover:bg-raised">Sign out and go back to sign in</SignOutButton>
          </div>
        </section>
      </div>
    </main>
  );
}

async function DeniedDetails({ searchParams }: { searchParams: SearchParams }) {
  if (await currentPerson()) redirect("/meetings");
  const params = await searchParams;
  const raw = first(params.email)?.trim().toLowerCase();
  const email = raw && looksLikeEmail(raw) ? raw : undefined;
  return <DeniedCopy email={email} />;
}

function DeniedCopy({ email }: { email?: string }) {
  return (
    <p className="mt-4 text-[15px] leading-[22px] text-ink-2">
      {email ? (
        <>
          <span className="font-mono text-[14px] text-ink">{email}</span> proved who you are, but only people on the DNY team list can use
          this app.
        </>
      ) : (
        "Google proved who you are, but only people on the DNY team list can use this app."
      )}
    </p>
  );
}
