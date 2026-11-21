// GET /api/calls/[id]/audio-url[?download=1]: a short-lived link to one call's recording in the private
// bucket, for the signed-in person the call is open to. Business calls are open to every active person; an
// undecided call only to admins and the people on its line; a deleted recording never. Links last an hour
// for playback and a minute for a download (named from the call's IST time, never a number or a name). The
// reply is never cached; signed out, the proxy answers 401 JSON before this runs.

import type { NextRequest } from "next/server";
import { currentPerson } from "@/lib/auth/require-user";
import { callsDb } from "@/lib/calls/db";
import { RECORDINGS_BUCKET } from "@/lib/calls/purge";
import { supabaseServer } from "@/lib/supabase/server";
import { decideAudioAccess, downloadFileName } from "@/lib/ui/audio-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAY_SECONDS = 3600;
const DOWNLOAD_SECONDS = 60;
const HEADERS = { "cache-control": "private, no-store" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const person = await currentPerson();
  if (!person) return Response.json({ error: "signed_out" }, { status: 401, headers: HEADERS });
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });

  // Through RLS as this person: the call, and the lines they are on.
  const db = await supabaseServer();
  const [call, lines] = await Promise.all([
    db.from("phone_calls").select("recording_path, recording_mime, recording_playable, recording_status, purged_at, line_id, meeting:meetings!inner(type, happened_at)").eq("meeting_id", id).maybeSingle(),
    db.from("phone_line_members").select("line_id").eq("person_id", person.id),
  ]);
  if (call.error || lines.error) return Response.json({ error: "unavailable" }, { status: 503, headers: HEADERS });
  if (!call.data?.meeting) return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });
  const row = call.data;

  const access = decideAudioAccess({
    purgedAt: row.purged_at,
    recordingStatus: row.recording_status,
    path: row.recording_path,
    type: row.meeting.type,
    isAdmin: person.role === "admin",
    isLineMember: (lines.data ?? []).some((l) => l.line_id === row.line_id),
  });
  if (!access.ok) return Response.json({ reason: access.reason }, { status: access.status, headers: HEADERS });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const seconds = download ? DOWNLOAD_SECONDS : PLAY_SECONDS;
  const { data, error } = await callsDb()
    .storage.from(RECORDINGS_BUCKET)
    .createSignedUrl(row.recording_path!, seconds, download ? { download: downloadFileName(row.meeting.happened_at, row.recording_mime) } : undefined);
  if (error || !data?.signedUrl) return Response.json({ error: "sign_failed" }, { status: 502, headers: HEADERS });
  return Response.json({ url: data.signedUrl, expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), mime: row.recording_mime, playable: row.recording_playable }, { headers: HEADERS });
}
