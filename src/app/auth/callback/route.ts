import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { currentPerson } from "@/lib/auth/require-user";
import { destinationAfterSignIn, exchangeFailureCode, readCallback } from "@/lib/auth/sign-in";
import { supabaseServer } from "@/lib/supabase/server";

// Sign-in lands here from Google (?code=, PKCE started in this browser) or from the emailed link
// (?token_hash=&type=, works on any device). Supabase then has a session; the team list decides
// whether it stays: Google only proves who someone is, an active people row is what grants access.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = url.searchParams.get("next");
  const go = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  const fail = (code: string) => go(`/login?error=${code}`);

  const input = readCallback(url.searchParams);
  if (input.kind === "provider_error" || input.kind === "incomplete") {
    console.warn(`auth callback: ${input.kind}${input.kind === "provider_error" ? ` (${input.code})` : ""}`);
    return fail(exchangeFailureCode(input));
  }

  const supabase = await supabaseServer();
  const { data, error } =
    input.kind === "code"
      ? await supabase.auth.exchangeCodeForSession(input.code)
      : await supabase.auth.verifyOtp({ token_hash: input.tokenHash, type: input.type as EmailOtpType });
  if (error || !data.user) {
    console.warn(`auth callback: ${input.kind} exchange failed: ${error?.message ?? "no user"}`);
    return fail(exchangeFailureCode(input));
  }

  const person = await currentPerson();
  if (!person) {
    // Signed in to Supabase but not on the list: drop the session so the stray account cannot linger.
    await supabase.auth.signOut();
    return go(destinationAfterSignIn(false, data.user.email, next));
  }
  return go(destinationAfterSignIn(true, data.user.email, next));
}
