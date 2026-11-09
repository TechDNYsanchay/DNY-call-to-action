import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentPerson } from "@/lib/auth/require-user";
import { consentUrl, googleConfigured } from "@/lib/google";

// An admin connects the recording account's Google Calendar (tech@ for now): this sends them to
// Google's consent page; /api/google/callback stores the result.
const STATE_COOKIE = "cta_google_state";

export async function GET(request: Request) {
  const site = new URL(request.url).origin;
  const me = await currentPerson();
  if (me?.role !== "admin") return NextResponse.redirect(`${site}/bookings?google=admin-only`);
  if (!googleConfigured()) return NextResponse.redirect(`${site}/bookings?google=not-configured`);
  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(consentUrl(state, site));
  response.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: site.startsWith("https://"), sameSite: "lax", maxAge: 600, path: "/api/google" });
  return response;
}
