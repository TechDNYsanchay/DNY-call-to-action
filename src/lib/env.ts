// Typed access to environment variables. Server-only values fail fast with a clear message.

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value : undefined;
}

/** The app's public address without a trailing slash (sign-in redirects, links in emails). */
export function siteUrl(): string {
  const raw = optionalEnv("NEXT_PUBLIC_SITE_URL") ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3200");
  return raw.replace(/\/$/, "");
}

/** Email domain of DNY's own people; any other participant is treated as outside DNY. */
export const DNY_EMAIL_DOMAIN = "dnyhospitality.com";
