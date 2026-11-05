// Small text helpers for the screens: initials for avatars, Devanagari detection for quotes, plural
// words. Pure.

/** "Priya Nair" -> "PN"; falls back to the first letter of the email, then "?". */
export function initials(name: string | null | undefined, email?: string | null): string {
  const clean = name?.trim().replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  if (clean) {
    const parts = clean.split(" ").filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }
  const e = email?.trim();
  return e ? e[0].toUpperCase() : "?";
}

/** The part before the @, tidied: "priya.nair" -> "Priya Nair". */
export function nameFromEmail(email: string | null | undefined): string | null {
  const local = email?.split("@")[0];
  if (!local) return null;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

/** Devanagari block; quotes in Hindi use the devanagari font utility. */
export const hasDevanagari = (text: string | null | undefined): boolean => !!text && /[ऀ-ॿ]/.test(text);

/** "1 item" / "3 items". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** First name only, for owner pills ("Priya"). */
export const firstName = (name: string | null | undefined): string | null => name?.trim().split(/\s+/)[0] ?? null;

/** The organiser's company from an email, for meetings without a client ("tajhotels.com"). */
export const domainOf = (email: string | null | undefined): string | null => {
  const at = email?.lastIndexOf("@") ?? -1;
  return at > 0 ? email!.slice(at + 1).toLowerCase() : null;
};
