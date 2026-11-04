"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/** Browser client for sign-in and live updates. Reads go through row-level security. */
export function supabaseBrowser() {
  return createBrowserClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
