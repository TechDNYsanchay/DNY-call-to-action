import "server-only";

// CONTRACT (owned by the ingest module): fetch one meeting and its transcript from tl;dv by its tl;dv
// id and run it through intake, exactly as the webhook would. Used by the admin "Replay" action and
// by scripts/replay-webhook.mts. Returns the meeting's row id and its process status afterwards.
export async function replayMeeting(tldvMeetingId: string): Promise<{ meetingId: string; status: string }> {
  void tldvMeetingId;
  throw new Error("replayMeeting is not implemented yet");
}
