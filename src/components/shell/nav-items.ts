// The list of navigation items, kept in a plain module so the server shell can build it and the
// client nav (which needs the pathname) can render it. A "use client" module cannot export a
// function for the server to call, which is why this does not live in nav.tsx.

export type NavKey = "meetings" | "calls" | "book" | "review" | "mine" | "clients" | "settings";

export interface NavItem {
  key: NavKey;
  href: string;
  label: string;
  short: string;
  badge?: number;
}

/** calls_nav(): whether Calls shows (a line is on, or a call exists) and how many calls wait for this person. */
export interface CallsNav {
  visible: boolean;
  decisions: number;
}

/** Calls, when it shows, sits right after Meetings with its own decisions badge; otherwise the list is as before. */
export function navItems(reviewCount: number, isAdmin: boolean, calls?: CallsNav): NavItem[] {
  return [
    { key: "meetings", href: "/meetings", label: "Meetings", short: "Meetings" },
    ...(calls?.visible ? [{ key: "calls" as const, href: "/calls", label: "Calls", short: "Calls", badge: calls.decisions }] : []),
    { key: "book", href: "/bookings", label: "Book a meeting", short: "Book" },
    { key: "review", href: "/review", label: "Needs review", short: "Review", badge: reviewCount },
    { key: "mine", href: "/mine", label: "My actions", short: "Mine" },
    { key: "clients", href: "/clients", label: "Clients", short: "Clients" },
    ...(isAdmin ? [{ key: "settings" as const, href: "/settings", label: "Settings", short: "Settings" }] : []),
  ];
}

/** The phone tab bar: every item but Settings, which lives behind the avatar (five tabs, six with Calls). */
export const tabItems = (items: NavItem[]): NavItem[] => items.filter((i) => i.key !== "settings");
