// The list of navigation items, kept in a plain module so the server shell can build it and the
// client nav (which needs the pathname) can render it. A "use client" module cannot export a
// function for the server to call, which is why this does not live in nav.tsx.

export type NavKey = "meetings" | "review" | "mine" | "clients" | "settings";

export interface NavItem {
  key: NavKey;
  href: string;
  label: string;
  short: string;
  badge?: number;
}

export function navItems(reviewCount: number, isAdmin: boolean): NavItem[] {
  return [
    { key: "meetings", href: "/meetings", label: "Meetings", short: "Meetings" },
    { key: "review", href: "/review", label: "Needs review", short: "Review", badge: reviewCount },
    { key: "mine", href: "/mine", label: "My actions", short: "Mine" },
    { key: "clients", href: "/clients", label: "Clients", short: "Clients" },
    ...(isAdmin ? [{ key: "settings" as const, href: "/settings", label: "Settings", short: "Settings" }] : []),
  ];
}
