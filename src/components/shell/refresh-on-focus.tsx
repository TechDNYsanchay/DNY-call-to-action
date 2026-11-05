"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Re-fetches the page data when the tab regains focus, at most once every `minMs` (default 20 s). */
export function RefreshOnFocus({ minMs = 20_000 }: { minMs?: number }) {
  const router = useRouter();
  const last = useRef(0);
  useEffect(() => {
    last.current = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last.current < minMs) return;
      last.current = now;
      router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, minMs]);
  return null;
}
