// The e2e suite's environment, set in every test worker before any test file loads: the local stack's
// URL and secret key under the names the app reads, fixed test values for the agent token, the cron secret,
// Callyzer and Deepgram (their hosts are faked by the tests), and no routine trigger. Nothing loads
// .env.local, and every other name the app reads is removed, so a value from the shell can never be used.
// The global fetch reaches only the local stack: a request to any other host is refused before it leaves.
import { LOCAL_HOSTS, localStackOrThrow } from "./e2e-guard";

const { url, secretKey } = localStackOrThrow();

for (const name of [
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "ROUTINE_FIRE_URL",
  "ROUTINE_FIRE_TOKEN",
  "TLDV_API_KEY",
  "TLDV_API_BASE",
  "TLDV_WEBHOOK_SECRET",
  "TLDV_TIMESTAMP_PARAM",
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "RECORDING_ACCOUNT_EMAIL",
  "REPLAY_URL",
]) {
  delete process.env[name];
}

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: url,
  SUPABASE_SECRET_KEY: secretKey,
  NEXT_PUBLIC_SITE_URL: "http://localhost:3200",
  AGENT_TOKEN: "e2e-token",
  CRON_SECRET: "e2e-cron-secret",
  CALLYZER_API_BASE: "https://sandbox.api.callyzer.co",
  CALLYZER_API_KEY: "e2e-callyzer-key",
  DEEPGRAM_API_KEY: "e2e-deepgram-key",
});

// CALLYZER_API_BASE names the live host: a route that should have stopped, or a step that forgot its
// faked fetch, must fail here rather than reach Callyzer or Deepgram. The tests' fakes are injected as
// the job's own fetch, and only call this one for the local storage's signed links.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  let host = "";
  try {
    host = new URL(input instanceof Request ? input.url : String(input)).hostname;
  } catch {
    // Not a URL: refused below.
  }
  return LOCAL_HOSTS.includes(host) ? realFetch(input, init) : Promise.reject(new Error(`e2e: refused a request to ${host || "something that is not a URL"}`));
};
