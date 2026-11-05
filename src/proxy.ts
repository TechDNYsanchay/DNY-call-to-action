import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth-paths";
import { requireEnv } from "@/lib/env";
import { retryingFetch } from "@/lib/supabase/retry-fetch";

// Runs before every page: refreshes the Supabase session cookie and sends anyone who is not
// signed in to /login. The refresh has to happen here because pages cannot write cookies. Whether
// the signed-in person is on the team list is checked by requireUser() in each page, not here.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    global: { fetch: retryingFetch },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // A response that sets auth cookies must never be cached and served to someone else.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Nothing may run between creating the client and this call: it is what refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isPublicPath(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return withCookies(NextResponse.redirect(login), response);
  }

  if (signedIn && pathname === "/login") {
    return withCookies(NextResponse.redirect(new URL("/meetings", request.url)), response);
  }

  return response;
}

/** A redirect must carry any cookies the refresh just wrote, or the next request refreshes again. */
function withCookies(redirect: NextResponse, from: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
