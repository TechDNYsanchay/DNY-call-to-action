"use client";

import clsx from "clsx";
import { Buildings, GearSix, ListChecks, Tray, UserCircleCheck } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip, TooltipProvider } from "@/components/ui/primitives";

// Navigation for the three shell sizes. One list of items, three renderings: the 240 px rail
// (labels), the 64 px icon rail (tooltips) and the phone tab bar (four items, Settings via the
// avatar). Active state comes from the pathname so the server shell stays static.

import type { NavItem, NavKey } from "./nav-items";

export type { NavItem, NavKey };

const ICONS: Record<NavKey, typeof Tray> = { meetings: Tray, review: UserCircleCheck, mine: ListChecks, clients: Buildings, settings: GearSix };

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function Badge({ count, compact }: { count?: number; compact?: boolean }) {
  if (!count) return null;
  return (
    <span
      aria-label={`${count} waiting`}
      className={clsx("inline-flex min-w-[18px] items-center justify-center rounded-full bg-sienna px-1 font-mono text-[11px] font-medium leading-[18px] text-sheet tnum", compact && "absolute -top-0.5 -right-0.5")}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** 240 px rail links: icon, label, badge. */
export function RailNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.key];
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={clsx("flex h-9 items-center gap-2.5 rounded-chip px-2.5 text-[14px] font-medium transition-colors duration-150", active ? "bg-sheet text-ink shadow-card" : "text-ink-2 hover:bg-raised hover:text-ink")}
          >
            <Icon size={18} aria-hidden="true" className={active ? "text-ink" : "text-ink-3"} />
            <span className="flex-1">{item.label}</span>
            <Badge count={item.badge} />
          </Link>
        );
      })}
    </nav>
  );
}

/** 64 px icon rail with tooltips (768 to 1279). */
export function IconRailNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <TooltipProvider>
      <nav aria-label="Main" className="flex flex-col items-center gap-1">
        {items.map((item) => {
          const Icon = ICONS[item.key];
          const active = isActive(pathname, item.href);
          return (
            <Tooltip key={item.key} label={item.label}>
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={clsx("relative flex size-11 items-center justify-center rounded-chip transition-colors duration-150", active ? "bg-sheet text-ink shadow-card" : "text-ink-2 hover:bg-raised hover:text-ink")}
              >
                <Icon size={20} aria-hidden="true" />
                <Badge count={item.badge} compact />
              </Link>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}

/** Phone bottom tab bar: Meetings, Review, Mine, Clients. Settings lives behind the avatar. */
export function TabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const tabs = items.filter((i) => i.key !== "settings");
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas/95 pb-safe backdrop-blur md:hidden">
      <ul className="grid h-14 grid-cols-4">
        {tabs.map((item) => {
          const Icon = ICONS[item.key];
          const active = isActive(pathname, item.href);
          return (
            <li key={item.key}>
              <Link href={item.href} aria-current={active ? "page" : undefined} className={clsx("relative flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-ink" : "text-ink-3")}>
                <span className="relative">
                  <Icon size={22} weight={active ? "fill" : "regular"} aria-hidden="true" />
                  <Badge count={item.badge} compact />
                </span>
                {item.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
