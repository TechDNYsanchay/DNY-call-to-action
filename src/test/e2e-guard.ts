// Runs once before the e2e suite (vitest.e2e.config.ts) and refuses to start unless the database is the
// local Supabase stack: the suite writes and deletes rows and stored objects, so it must never reach the
// production project. Values come from `npx supabase status` (the local stack's keys are not secrets).

export const LOCAL_HOSTS = ["127.0.0.1", "localhost"];

export function localStackOrThrow(): { url: string; secretKey: string } {
  const url = process.env.SUPABASE_LOCAL_URL ?? "";
  const secretKey = process.env.SUPABASE_LOCAL_SECRET_KEY ?? "";
  if (!url || !secretKey) {
    throw new Error("e2e: set SUPABASE_LOCAL_URL and SUPABASE_LOCAL_SECRET_KEY to the local stack's API_URL and SECRET_KEY (npx supabase status -o env). Nothing ran.");
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // Reported below.
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`e2e: the suite runs only against the local Supabase stack (127.0.0.1 or localhost), not ${host || "something that is not a URL"}. Nothing ran.`);
  }
  return { url, secretKey };
}

export default function setup(): void {
  localStackOrThrow();
}
