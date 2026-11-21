"use client";

import { useEffect } from "react";
import type { Availability } from "@/lib/ui/player";
import { type RecordingMeta, useRecording } from "./recording-provider";

// The page's word on the recording, rendered again on every refresh: "stored" lets the player fetch its link
// (once); anything else stops playback, clears the source and hides the dock at once. So a call deleted as not
// a work call in another tab, or whose audio passed the 30 days, stops playing within one refresh. A deleted
// call's skip code says why, so the player and Download name the right reason (no speech, not confirmed in
// time, the line switched off, or not a work call).

export function RecordingAvailability({ status, skipCode = null, title, artist, lengthSec }: { status: Availability; skipCode?: string | null } & RecordingMeta) {
  const { setAvailability, setMeta } = useRecording();
  useEffect(() => {
    setAvailability(status, skipCode);
  }, [status, skipCode, setAvailability]);
  useEffect(() => {
    setMeta({ title, artist, lengthSec });
  }, [title, artist, lengthSec, setMeta]);
  return null;
}
