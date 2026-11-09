// Google Calendar for booked client meetings: the recording account (RECORDING_ACCOUNT_EMAIL, tech@
// for now) connects once, and the app creates and cancels meetings on its calendar. Needs
// GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET, the same OAuth client Sales QA uses and
// separate from the sign-in client (GOOGLE_CLIENT_ID). Server only.

import "server-only";
import { DNY_EMAIL_DOMAIN } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { parseMeetCode } from "@/lib/tldv/parse";

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];
const TIMEOUT = 20_000;

/** A problem a person can fix (keys missing, not connected): its message is shown as it is. */
export class GoogleNotReady extends Error {}

export const googleConfigured = () => Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET);

/** The account that organises every booked meeting, so tl;dv's bot records it. */
export const recordingAccount = () => (process.env.RECORDING_ACCOUNT_EMAIL || `tech@${DNY_EMAIL_DOMAIN}`).trim().toLowerCase();

export const redirectUri = (site: string) => `${site}/api/google/callback`;

/** Google's consent page for the recording account, asking for a refresh token. */
export function consentUrl(state: string, site: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "",
    redirect_uri: redirectUri(site),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    hd: DNY_EMAIL_DOMAIN,
    login_hint: recordingAccount(),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "", ...body }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; id_token?: string; error?: string; error_description?: string };
  if (!response.ok) throw new Error(`Google sign-in: ${json.error_description ?? json.error ?? `HTTP ${response.status}`}`);
  return json;
}

/** The email in an ID token straight from Google's token endpoint (over TLS, so not re-verified). */
function emailOf(idToken: string | undefined): string | null {
  try {
    const payload = JSON.parse(Buffer.from((idToken ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string; email_verified?: boolean };
    return payload.email && payload.email_verified !== false ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Finishes the consent: stores the refresh token. Only the recording account is accepted, because
 * tl;dv records meetings that account organises; any other calendar would give meetings nobody records.
 */
export async function saveConnection(code: string, site: string, connectedBy: string): Promise<string> {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(site) });
  const email = emailOf(tokens.id_token);
  if (email !== recordingAccount()) throw new Error(`Sign in as ${recordingAccount()} (the account tl;dv records), not ${email ?? "another account"}`);
  if (!tokens.refresh_token) throw new Error("Google didn't return a long-lived token; remove the app's access in the Google account and connect again");
  const { error } = await supabaseAdmin()
    .from("google_connection")
    .upsert({ id: true, email, refresh_token: tokens.refresh_token, connected_by: connectedBy, connected_at: new Date().toISOString() });
  if (error) throw new Error(`save connection: ${error.message}`);
  return email;
}

/** Which account meetings are created with, or null when none is connected. */
export async function connection(): Promise<{ email: string; connectedAt: string } | null> {
  const { data, error } = await supabaseAdmin().from("google_connection").select("email, connected_at").maybeSingle();
  if (error) throw new Error(`connection: ${error.message}`);
  return data ? { email: data.email, connectedAt: data.connected_at } : null;
}

async function accessToken(): Promise<string> {
  if (!googleConfigured()) throw new GoogleNotReady("Google Calendar isn't set up yet (the app's Google Calendar keys are missing)");
  const { data, error } = await supabaseAdmin().from("google_connection").select("refresh_token").maybeSingle();
  if (error) throw new Error(`connection: ${error.message}`);
  if (!data) throw new GoogleNotReady("Google Calendar isn't connected yet: an admin connects it on the Book page");
  const tokens = await tokenRequest({ refresh_token: data.refresh_token, grant_type: "refresh_token" });
  if (!tokens.access_token) throw new Error("Google didn't return an access token");
  return tokens.access_token;
}

async function calendar(path: string, init: { method: string; body?: unknown }, token?: string): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events${path}`, {
    method: init.method,
    headers: { authorization: `Bearer ${token ?? (await accessToken())}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT),
  });
}

type EventJson = { id?: string; hangoutLink?: string; conferenceData?: { conferenceId?: string; createRequest?: { status?: { statusCode?: string } } }; error?: { message?: string } };

/** Creates the event and emails the invites; returns the event id and its Meet link and code. */
export async function createMeeting(event: object): Promise<{ eventId: string; meetUrl: string; meetCode: string }> {
  const token = await accessToken();
  const response = await calendar("?conferenceDataVersion=1&sendUpdates=all", { method: "POST", body: event }, token);
  let json = (await response.json().catch(() => ({}))) as EventJson;
  if (!response.ok || !json.id) throw new Error(`Google Calendar: ${json.error?.message ?? `HTTP ${response.status}`}`);
  // The Meet link is usually ready at once; if Google is still making it, ask again shortly.
  for (let i = 0; i < 3 && !json.hangoutLink && json.conferenceData?.createRequest?.status?.statusCode === "pending"; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const again = await calendar(`/${encodeURIComponent(json.id!)}`, { method: "GET" }, token);
    if (again.ok) json = (await again.json()) as EventJson;
  }
  const code = parseMeetCode(json.conferenceData?.conferenceId) ?? parseMeetCode(json.hangoutLink);
  if (!json.hangoutLink || !code) {
    // An invite without a Meet link would never be recorded: take it back before reporting.
    await cancelMeeting(json.id!).catch(() => undefined);
    throw new Error("Google Calendar made the event but no Meet link; check that Google Meet is on for this account");
  }
  return { eventId: json.id!, meetUrl: json.hangoutLink, meetCode: code };
}

/** Deletes the event and emails the guests; an event already gone counts as cancelled. */
export async function cancelMeeting(eventId: string): Promise<void> {
  const response = await calendar(`/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const json = (await response.json().catch(() => ({}))) as EventJson;
    throw new Error(`Google Calendar: ${json.error?.message ?? `HTTP ${response.status}`}`);
  }
}
