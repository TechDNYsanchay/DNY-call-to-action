"use client";

import { useEffect, useState } from "react";
import { formatDateTimeIst, timeAgo } from "@/lib/format";

// "3 min ago" that keeps itself current (every 30 s) without a server round trip; the exact IST time is
// in the title. The first render uses the server's clock (`nowIso`), so the server and browser markup
// match; the browser's clock takes over at the first tick.

export function RelativeTime({ iso, nowIso, className, fallback = "never" }: { iso: string | null; nowIso: string; className?: string; fallback?: string }) {
  const [now, setNow] = useState(() => new Date(nowIso));
  useEffect(() => {
    if (!iso) return;
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [iso]);
  if (!iso) return <span className={className}>{fallback}</span>;
  return (
    <time dateTime={iso} title={formatDateTimeIst(iso)} className={className}>
      {timeAgo(iso, now)}
    </time>
  );
}
