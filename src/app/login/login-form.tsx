"use client";

import { ArrowRight, CheckCircle, GoogleLogo } from "@phosphor-icons/react";
import { useId, useState, type FormEvent } from "react";
import { DNY_EMAIL_DOMAIN } from "@/lib/env";
import { looksLikeEmail, otpErrorMessage } from "@/lib/auth/sign-in";
import { supabaseBrowser } from "@/lib/supabase/client";

type Props = { next: string; notice?: string };

// Google first (one tap for anyone on the Workspace), an email link as the quiet fallback. Both land
// on /auth/callback, which checks the team list; this form only starts the journey.
export function LoginForm({ next, notice }: Props) {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | undefined>(notice);
  const [formError, setFormError] = useState<string | undefined>();

  const callbackUrl = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function continueWithGoogle() {
    setBusy("google");
    setBanner(undefined);
    setFormError(undefined);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl(), queryParams: { hd: DNY_EMAIL_DOMAIN, prompt: "select_account" } },
    });
    // On success the browser is already on its way to Google; the button stays busy until then.
    if (error) {
      setBanner("Google sign-in couldn't start. Check your connection and try again.");
      setBusy(null);
    }
  }

  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!looksLikeEmail(address)) {
      setFormError("Enter a valid email address.");
      return;
    }
    setBusy("email");
    setBanner(undefined);
    setFormError(undefined);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: callbackUrl(), shouldCreateUser: false },
    });
    setBusy(null);
    if (error) {
      setFormError(otpErrorMessage(error));
      return;
    }
    setSentTo(address);
  }

  if (sentTo) {
    return (
      <div role="status" className="rounded-card bg-inset p-4">
        <p className="flex items-center gap-2 text-[15px] font-medium text-bottle">
          <CheckCircle size={18} weight="fill" aria-hidden="true" />
          Check your inbox
        </p>
        <p className="mt-2 text-[14px] leading-[20px] text-ink-2">
          A sign-in link is on its way to <span className="font-medium text-ink">{sentTo}</span>. It works once and expires in an hour.
        </p>
        <p className="mt-3 text-[13px] leading-[18px] text-ink-3">
          Nothing after a few minutes? Check spam, or{" "}
          <button type="button" onClick={() => setSentTo(null)} className="text-ink-2 underline decoration-strong underline-offset-2 hover:text-ink">
            send it again
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      {banner && (
        <p role="alert" className="mb-4 rounded-chip border-l-[3px] border-signal bg-signal-tint px-3 py-2 text-[13px] leading-[18px] text-ink">
          {banner}
        </p>
      )}

      <button
        type="button"
        onClick={continueWithGoogle}
        disabled={busy !== null}
        className="flex h-11 w-full items-center justify-center gap-2.5 rounded-chip bg-ink px-4 text-[14px] font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <GoogleLogo size={18} weight="bold" aria-hidden="true" />
        {busy === "google" ? "Opening Google…" : "Continue with Google"}
      </button>

      <div className="my-5 flex items-center gap-3 text-[12px] leading-[16px] text-ink-3" aria-hidden="true">
        <span className="h-px flex-1 bg-hairline" />
        or get a sign-in link by email
        <span className="h-px flex-1 bg-hairline" />
      </div>

      <form onSubmit={sendLink} noValidate className="space-y-3">
        <div>
          <label htmlFor={emailId} className="block text-[12px] font-semibold tracking-[0.04em] text-ink-2">
            Work email
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            required
            placeholder={`you@${DNY_EMAIL_DOMAIN}`}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? `${emailId}-error` : undefined}
            className="mt-1.5 h-11 w-full rounded-chip border border-hairline bg-inset px-3 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-strong"
          />
          {formError && (
            <p id={`${emailId}-error`} role="alert" className="mt-2 text-[13px] leading-[18px] text-signal">
              {formError}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={busy !== null}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-chip border border-strong bg-sheet px-4 text-[14px] font-medium text-ink transition-colors hover:bg-raised disabled:opacity-60"
        >
          {busy === "email" ? "Sending…" : "Email me a sign-in link"}
          {busy !== "email" && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </form>
    </div>
  );
}
