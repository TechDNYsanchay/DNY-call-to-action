// Google Calendar for booked client meetings: the recording account (RECORDING_ACCOUNT_EMAIL, tech@
// for now) connects once, and the app creates and cancels meetings on its calendar. Each meeting is
// then opened to anyone with the link (Google Meet access "Open"), so tl;dv's recorder joins without
// someone in the call having to admit it. Needs the Google Meet REST API turned on in the Google
// Cloud project, and
// GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET, the same OAuth client Sales QA uses and
// separate from the sign-in client (GOOGLE_CLIENT_ID). Server only.

import "server-only";
import { DNY_EMAIL_DOMAIN } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { parseMeetCode } from "@/lib/tldv/parse";

/** Lets the app change the access setting of a Meet that Google Calendar created. */
export const MEET_SETTINGS_SCOPE = "https://www.googleapis.com/auth/meetings.space.settings";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events", MEET_SETTINGS_SCOPE];
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
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; id_token?: string; scope?: string; error?: string; error_description?: string };
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
    .upsert({ id: true, email, refresh_token: tokens.refresh_token, scopes: (tokens.scope ?? "").split(/\s+/).filter(Boolean), connected_by: connectedBy, connected_at: new Date().toISOString() });
  if (error) throw new Error(`save connection: ${error.message}`);
  return email;
}

/**
 * Which account meetings are created with, or null when none is connected. `canOpenMeetings` is false
 * for a connection made before the app asked for the Meet permission: it needs one reconnect.
 */
export async function connection(): Promise<{ email: string; connectedAt: string; canOpenMeetings: boolean } | null> {
  const { data, error } = await supabaseAdmin().from("google_connection").select("email, connected_at, scopes").maybeSingle();
  if (error) throw new Error(`connection: ${error.message}`);
  return data ? { email: data.email, connectedAt: data.connected_at, canOpenMeetings: data.scopes.includes(MEET_SETTINGS_SCOPE) } : null;
}

async function session(): Promise<{ token: string; canOpenMeetings: boolean }> {
  if (!googleConfigured()) throw new GoogleNotReady("Google Calendar isn't set up yet (the app's Google Calendar keys are missing)");
  const { data, error } = await supabaseAdmin().from("google_connection").select("refresh_token, scopes").maybeSingle();
  if (error) throw new Error(`connection: ${error.message}`);
  if (!data) throw new GoogleNotReady("Google Calendar isn't connected yet: an admin connects it on the Client meetings page");
  const tokens = await tokenRequest({ refresh_token: data.refresh_token, grant_type: "refresh_token" });
  if (!tokens.access_token) throw new Error("Google didn't return an access token");
  // The token's own scope list is the truth; the stored one covers a response without it.
  const granted = tokens.scope ? tokens.scope.split(/\s+/) : data.scopes;
  return { token: tokens.access_token, canOpenMeetings: granted.includes(MEET_SETTINGS_SCOPE) };
}

const accessToken = async () => (await session()).token;

async function calendar(path: string, init: { method: string; body?: unknown }, token?: string): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events${path}`, {
    method: init.method,
    headers: { authorization: `Bearer ${token ?? (await accessToken())}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT),
  });
}

type EventJson = { id?: string; hangoutLink?: string; conferenceData?: { conferenceId?: string; createRequest?: { status?: { statusCode?: string } } }; error?: { message?: string } };

export interface CreatedMeeting {
  eventId: string;
  meetUrl: string;
  meetCode: string;
  /** Null when the Meet is open, so tl;dv's recorder joins by itself; otherwise why it is not. */
  recorderMustBeAdmitted: string | null;
}

/**
 * Creates the event and emails the invites, then opens the Meet to anyone with the link. Opening is
 * best effort: if it fails the meeting still stands, and the reason comes back for the booker.
 */
export async function createMeeting(event: object): Promise<CreatedMeeting> {
  const { token, canOpenMeetings } = await session();
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
  const recorderMustBeAdmitted = canOpenMeetings
    ? await openToAnyoneWithLink(code, token)
    : "Google Calendar was connected before the app could open meetings: an admin reconnects it once on the Client meetings page";
  return { eventId: json.id!, meetUrl: json.hangoutLink, meetCode: code, recorderMustBeAdmitted };
}

/**
 * Sets the Meet's access to "Open": anyone with the link joins without knocking, so tl;dv's recorder
 * needs nobody to admit it. Returns null when done, otherwise the reason (never throws).
 */
async function openToAnyoneWithLink(meetCode: string, token: string): Promise<string | null> {
  const meet = (path: string, init: { method: string; body?: unknown }) =>
    fetch(`https://meet.googleapis.com/v2/${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
    });
  type SpaceJson = { name?: string; config?: { accessType?: string }; error?: { message?: string } };
  const reason = (json: SpaceJson, response: Response) => {
    const message = json.error?.message ?? `HTTP ${response.status}`;
    if (/has not been used|is disabled/i.test(message)) return "the Google Meet REST API is turned off in the Google Cloud project";
    if (/insufficient|scope/i.test(message)) return "the Google connection lacks the Meet permission: an admin reconnects Google Calendar once";
    return `Google Meet: ${message.slice(0, 200)}`;
  };
  try {
    // A meeting code is an alias for its space; the update needs the space's own name.
    const found = await meet(`spaces/${encodeURIComponent(meetCode)}`, { method: "GET" });
    const space = (await found.json().catch(() => ({}))) as SpaceJson;
    if (!found.ok || !space.name) return reason(space, found);
    if (space.config?.accessType === "OPEN") return null;
    const updated = await meet(`${space.name}?updateMask=config.accessType`, { method: "PATCH", body: { config: { accessType: "OPEN" } } });
    const result = (await updated.json().catch(() => ({}))) as SpaceJson;
    if (!updated.ok) return reason(result, updated);
    return result.config?.accessType === "OPEN" ? null : "Google kept the meeting closed (a Workspace admin setting may block open meetings)";
  } catch (error) {
    return `Google Meet didn't answer: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Deletes the event and emails the guests; an event already gone counts as cancelled. */
export async function cancelMeeting(eventId: string): Promise<void> {
  const response = await calendar(`/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const json = (await response.json().catch(() => ({}))) as EventJson;
    throw new Error(`Google Calendar: ${json.error?.message ?? `HTTP ${response.status}`}`);
  }
}
