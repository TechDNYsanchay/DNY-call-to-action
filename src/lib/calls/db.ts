import "server-only";

// The calls job's own Supabase client (secret key, bypasses RLS), used only by the calls job, the purge
// helpers and the retention route. Unlike supabaseAdmin() it never retries, so a reply lost on the way
// back can never lease a second row, and every request has its own timeout so each step fits the job's
// time budget (src/lib/calls/budget.ts): 20 s for storage object writes and removals, 6 s for the rest.

import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";
import type { Db } from "@/lib/supabase/server";
import { TIMEOUT_MS } from "./budget";

/** 20 s for storage object requests (uploads, removals) except signing a link; 6 s for everything else. */
export function timeoutFor(url: string): number {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not absolute: match on the text as given.
  }
  return path.includes("/storage/v1/object/") && !path.includes("/storage/v1/object/sign/") ? TIMEOUT_MS.storageWrite : TIMEOUT_MS.db;
}

const urlOf = (input: Parameters<typeof fetch>[0]): string => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

/**
 * A fetch that gives every request its own timeout (joined with the caller's signal, when there is one)
 * and makes exactly one attempt. `base` is looked up at call time, so tests can replace the global fetch.
 */
export function timeoutFetch(timeoutFor: (url: string) => number, base: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutFor(urlOf(input)));
    return base(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
}

let client: Db | undefined;

export function callsDb(): Db {
  client ??= createClient<Database>(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timeoutFetch(timeoutFor) },
  });
  return client;
}
