// Pure helpers for the sign-in flow (used by the proxy and the auth routes).

/** Pages and routes that work without a session. Webhook, cron and agent routes check their own secrets. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/denied" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/agent/") ||
    pathname === "/api/health"
  );
}

/** Only same-site paths, so a sign-in link can never send someone to another website. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/meetings";
  if (isPublicPath(next.split("?")[0])) return "/meetings";
  return next;
}
