"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { RefreshOnFocus } from "@/components/shell/refresh-on-focus";

// Keeps the Calls list current. Realtime tells it when any call row is inserted or changes; the list is
// fetched again once things have been quiet for 1.5 s, at most every 5 s (a burst never waits longer than
// 10 s), and only while the tab is visible (a hidden tab catches up when it is shown). While any call on
// screen is still moving, a 60 s poll backs Realtime up, in case the socket is blocked on the network.

const QUIET_MS = 1_500;
const MIN_GAP_MS = 5_000;
const MAX_WAIT_MS = 10_000;
const POLL_MS = 60_000;

export function CallsLive({ polling }: { polling: boolean }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = supabaseBrowser();
    let timer: number | null = null;
    let lastRefresh = 0;
    let firstEvent = 0;
    let owed = false;
    const flush = () => {
      timer = null;
      if (document.visibilityState !== "visible") {
        owed = true;
        return;
      }
      owed = false;
      firstEvent = 0;
      lastRefresh = Date.now();
      router.refresh();
    };
    const schedule = () => {
      const now = Date.now();
      if (!firstEvent) firstEvent = now;
      if (timer) window.clearTimeout(timer);
      const wait = now - firstEvent >= MAX_WAIT_MS ? 0 : Math.max(QUIET_MS, MIN_GAP_MS - (now - lastRefresh));
      timer = window.setTimeout(flush, wait);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && owed) schedule();
    };
    const channel = supabase
      .channel("calls-list")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "meetings", filter: "kind=eq.call" }, schedule)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "meetings", filter: "kind=eq.call" }, schedule)
      .subscribe();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, router]);

  return <RefreshOnFocus />;
}
