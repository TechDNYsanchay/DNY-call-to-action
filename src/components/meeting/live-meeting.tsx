"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

// While a meeting is still being processed, listen for changes to its row and re-render the page
// when they arrive. One channel per page, torn down on unmount. A slow poll backs up Realtime in
// case the socket is blocked on the network.

export function LiveMeeting({ id, active, pollMs = 90_000 }: { id: string; active: boolean; pollMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`meeting:${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "meetings", filter: `id=eq.${id}` }, () => router.refresh())
      .subscribe();
    const timer = window.setInterval(() => router.refresh(), pollMs);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [id, active, pollMs, router]);
  return null;
}
