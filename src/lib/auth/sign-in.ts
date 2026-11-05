// Pure helpers for the sign-in flow: what the callback found in the URL, which short error code to
// send back to /login, and the plain-English sentence each code means. No Supabase here, so the
// proxy, the login page and the callback route can all share it and it is testable.

import { safeNextPath } from "@/lib/auth-paths";

/** Short codes that travel in /login?error=; the login page turns them into sentences. */
export type SignInErrorCode = "link" | "google" | "no-access" | "incomplete";

const MESSAGES: Record<SignInErrorCode, string> = {
  link: "That sign-in link has expired or was already used. Send yourself a new one below.",
  google: "Google sign-in didn't work. Try again with your @dnyhospitality.com account, or use an email link.",
  "no-access": "That account isn't on the DNY team list. Ask tech@dnyhospitality.com to add you.",
  incomplete: "That link was incomplete. Open it again from the email, or sign in below.",
};

/** The sentence for a code from the URL, or undefined for anything unknown (never echo raw input). */
export function signInErrorMessage(code: string | null | undefined): string | undefined {
  return code && code in MESSAGES ? MESSAGES[code as SignInErrorCode] : undefined;
}

/** What the callback URL carries. Supabase sends either a PKCE code, a magic-link token, or an error. */
export type CallbackInput =
  | { kind: "provider_error"; code: SignInErrorCode }
  | { kind: "code"; code: string }
  | { kind: "token"; tokenHash: string; type: string }
  | { kind: "incomplete" };

export function readCallback(params: URLSearchParams): CallbackInput {
  const providerError = params.get("error_description") ?? params.get("error_code") ?? params.get("error");
  if (providerError) return { kind: "provider_error", code: providerErrorCode(providerError) };
  const code = params.get("code");
  if (code) return { kind: "code", code };
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash && type) return { kind: "token", tokenHash, type };
  return { kind: "incomplete" };
}

/**
 * Supabase reports failures as query parameters on the redirect. A Google account with no login
 * here comes back as "Signups not allowed" because sign-ups are closed: that is a team-list problem,
 * everything else is an expired or broken link.
 */
export function providerErrorCode(description: string): SignInErrorCode {
  if (/signups?[ _]not[ _]allowed|signup_disabled|banned|not[ _]authori[sz]ed/i.test(description)) return "no-access";
  if (/otp_expired|expired|invalid|bad_oauth/i.test(description)) return "link";
  return "link";
}

/** Which error to show when exchanging the code or token failed. */
export function exchangeFailureCode(input: CallbackInput): SignInErrorCode {
  if (input.kind === "code") return "google";
  if (input.kind === "incomplete") return "incomplete";
  if (input.kind === "provider_error") return input.code;
  return "link";
}

/**
 * Where to send someone once Supabase has a session for them. Signed in but not on the team list
 * goes to /denied with the address, so the page can say which account was tried.
 */
export function destinationAfterSignIn(onTeamList: boolean, email: string | null | undefined, next: string | null | undefined): string {
  if (onTeamList) return safeNextPath(next);
  const address = email?.trim().toLowerCase();
  return address ? `/denied?email=${encodeURIComponent(address)}` : "/denied";
}

/** The messages the login form shows for errors from signInWithOtp, in plain words. */
export function otpErrorMessage(error: { code?: string; status?: number; message?: string } | null | undefined): string {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "otp_disabled" || code === "signup_disabled" || /signups? not allowed/i.test(message)) {
    return "That email isn't on the DNY team list yet. Ask tech@dnyhospitality.com to add you.";
  }
  if (code === "user_banned") return "That account has been deactivated. Ask tech@dnyhospitality.com if that is a mistake.";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error?.status === 429) {
    return "Too many links were sent just now. Wait a few minutes and try again.";
  }
  if (code === "email_address_invalid" || code === "validation_failed") return "Enter a valid email address.";
  return "The link couldn't be sent just now. Try again in a minute.";
}

/** A very light check before asking Supabase: one @, something either side, no spaces. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
