import type { Metadata } from "next";
import { Suspense } from "react";
import { safeNextPath } from "@/lib/auth-paths";
import { signInErrorMessage } from "@/lib/auth/sign-in";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// One calm sheet on the canvas: wordmark, the one serif line, the sign-in card, the footnote.
// ?next= is where to go afterwards (checked, same-site only); ?error= is a short code from the callback.
// The query read is request-time work, so only the form waits on it; the rest of the page prerenders.
export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center">
        <header>
          <p className="text-[17px] font-semibold tracking-[-0.01em] text-ink">Call to Action</p>
          <p className="mt-0.5 text-[13px] leading-[18px] text-ink-3">DNY Hospitality</p>
        </header>

        <p className="mt-8 font-serif text-[26px] leading-[1.25] tracking-[-0.01em] text-ink text-balance sm:text-[30px]">
          Every client meeting, turned into one clear sheet of actions.
        </p>

        {/* The three numbers a manager reads first, as a quiet hint of what is inside. */}
        <ul aria-hidden="true" className="tnum mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-[13px] leading-[18px] text-ink-3">
          <li>
            <span className="text-[18px] font-medium text-bottle">4</span> for DNY
          </li>
          <li>
            <span className="text-[18px] font-medium text-sienna">2</span> for client
          </li>
          <li>
            <span className="text-[18px] font-medium text-ink">3</span> decisions
          </li>
        </ul>

        <section aria-labelledby="sign-in-title" className="card mt-8 p-5 sm:p-6">
          <h1 id="sign-in-title" className="text-[15px] font-semibold text-ink">
            Sign in
          </h1>
          <p className="mt-1 text-[13px] leading-[18px] text-ink-2">Use your DNY Google account, or get a one-time link by email.</p>
          <div className="mt-5">
            <Suspense fallback={<FormSkeleton />}>
              <LoginFormFromQuery searchParams={searchParams} />
            </Suspense>
          </div>
        </section>

        <p className="mt-6 text-[13px] leading-[18px] text-ink-3">
          Only people on the DNY team list can sign in. Ask{" "}
          <a href="mailto:tech@dnyhospitality.com" className="text-ink-2 underline decoration-strong underline-offset-2 hover:text-ink">
            tech@dnyhospitality.com
          </a>{" "}
          to be added.
        </p>
      </div>
    </main>
  );
}

async function LoginFormFromQuery({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return <LoginForm next={safeNextPath(first(params.next))} notice={signInErrorMessage(first(params.error))} />;
}

// Same height as the form's two controls, so nothing jumps when it streams in.
function FormSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3">
      <div className="h-11 animate-pulse rounded-chip bg-raised" />
      <div className="h-11 animate-pulse rounded-chip bg-raised" />
    </div>
  );
}
