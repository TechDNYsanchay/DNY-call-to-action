import "server-only";

// CONTRACT (owned by the ingest module): fetch one meeting and its transcript from tl;dv by its tl;dv
// id and run it through intake, exactly as the webhook would. Used by the admin "Replay" action and
// by scripts/replay-webhook.mts. Returns the meeting's row id and its process status afterwards.

import { syncMeeting } from "./sync";

export async function replayMeeting(tldvMeetingId: string): Promise<{ meetingId: string; status: string }> {
  const id = tldvMeetingId.trim();
  if (!id) throw new Error("A tl;dv meeting id is required");
  const result = await syncMeeting(id, "manual");
  if (!result.meetingId) throw new Error(`tl;dv does not know a meeting with id ${id}`);
  return { meetingId: result.meetingId, status: result.status };
}
