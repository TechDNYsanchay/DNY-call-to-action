import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// POST from the SignOutButton (and the /denied page): ends the Supabase session and lands on /login.
// POST only, so a stray image tag or link cannot sign someone out.
export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signOut();
  if (error) console.warn(`sign out: ${error.message}`);
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin), { status: 303 });
}
