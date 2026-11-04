import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";
import type { Database } from "./database.types";
import { retryingFetch } from "./retry-fetch";

export type Db = SupabaseClient<Database>;

/** The signed-in person's client: reads go through row-level security. Server Components, actions, routes. */
export async function supabaseServer(): Promise<Db> {
  const cookieStore = await cookies();
  return createServerClient<Database>(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    global: { fetch: retryingFetch },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session cookie instead.
        }
      },
    },
  });
}

let admin: Db | undefined;

/**
 * Service-role client (bypasses RLS). Only for the pipeline (webhook, cron, agent API) and for
 * server actions after requireUser() has checked the person. Never import from a client component.
 */
export function supabaseAdmin(): Db {
  admin ??= createClient<Database>(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: retryingFetch },
  });
  return admin;
}
