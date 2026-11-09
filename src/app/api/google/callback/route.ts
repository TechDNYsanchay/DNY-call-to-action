import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentPerson } from "@/lib/auth/require-user";
import { saveConnection } from "@/lib/google";
import { secretMatches } from "@/lib/webhooks";

// Google sends the admin back here after the consent page; the refresh token is stored for the
// recording account, and meetings are created on its calendar from then on.
const STATE_COOKIE = "cta_google_state";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const site = url.origin;
  const back = (status: string, reason?: string) => {
    const response = NextResponse.redirect(`${site}/bookings?google=${status}${reason ? `&reason=${encodeURIComponent(reason.slice(0, 200))}` : ""}`);
    response.cookies.delete({ name: STATE_COOKIE, path: "/api/google" });
    return response;
  };

  const me = await currentPerson();
  if (me?.role !== "admin") return back("admin-only");
  const state = (await cookies()).get(STATE_COOKIE)?.value;
  if (!secretMatches(url.searchParams.get("state"), state)) return back("error", "The sign-in took too long or was opened twice; try Connect again");
  const googleError = url.searchParams.get("error");
  if (googleError) return back("error", googleError === "access_denied" ? "Access wasn't allowed on Google's page" : googleError);
  const code = url.searchParams.get("code");
  if (!code) return back("error", "Google didn't send a sign-in code");

  try {
    return back("connected", await saveConnection(code, site, me.id));
  } catch (error) {
    return back("error", error instanceof Error ? error.message : String(error));
  }
}
