import { SignOut } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/app/auth/signout/sign-out-button";
import type { Person } from "@/lib/auth/require-user";
import { Avatar } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastProvider } from "@/components/ui/toast";
import { IconRailNav, RailNav, TabBar } from "./nav";
import { navItems } from "./nav-items";
import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";

// The signed-in shell. Desktop (1280+): 240 px rail. Tablet (768 to 1279): 64 px icon rail.
// Phone: 56 px top bar + bottom tab bar. The content column is sized by each page (880 px for
// the sheet). Server component; only the nav (active state), toggle and toasts run on the client.

export function AppShell({ person, isAdmin, reviewCount, children }: { person: Pick<Person, "full_name" | "email">; isAdmin: boolean; reviewCount: number; children: ReactNode }) {
  const items = navItems(reviewCount, isAdmin);
  return (
    <ToastProvider>
      <div className="min-h-dvh md:flex">
        <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-chip focus:bg-ink focus:px-3 focus:py-2 focus:text-sheet">
          Skip to content
        </a>

        {/* Desktop rail */}
        <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col border-r border-hairline px-3 py-4 xl:flex">
          <Wordmark className="mx-1 mb-6" />
          <RailNav items={items} />
          <div className="mt-auto border-t border-hairline pt-3">
            <div className="flex items-center gap-2.5 px-1.5 py-1.5">
              <Avatar name={person.full_name} email={person.email} size={28} side="dny" />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[13px] font-medium text-ink">{person.full_name}</p>
                <p className="truncate text-[12px] text-ink-3">{person.email}</p>
              </div>
              <ThemeToggle />
            </div>
            <SignOutButton className="mt-1 h-9 w-full justify-start px-2.5">
              <SignOut size={16} aria-hidden="true" />
              Sign out
            </SignOutButton>
          </div>
        </aside>

        {/* Tablet icon rail */}
        <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col items-center border-r border-hairline py-4 md:flex xl:hidden">
          <Wordmark compact className="mb-6 size-11 justify-center" />
          <IconRailNav items={items} />
          <div className="mt-auto flex flex-col items-center gap-1">
            <ThemeToggle />
            <SignOutButton className="size-11 px-0 lg:size-9">
              <SignOut size={18} aria-label="Sign out" />
            </SignOutButton>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Phone top bar */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-hairline bg-canvas/95 px-4 backdrop-blur md:hidden">
            <Wordmark />
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <Link href="/settings" aria-label="Your account and settings" className="inline-flex size-11 items-center justify-center rounded-chip">
                <Avatar name={person.full_name} email={person.email} size={28} />
              </Link>
            </div>
          </header>

          <main id="content" className="px-4 pt-4 pb-[calc(80px+env(safe-area-inset-bottom,0px))] md:px-6 md:pt-6 md:pb-12 lg:px-8">
            {children}
          </main>
        </div>

        <TabBar items={items} />
      </div>
    </ToastProvider>
  );
}

/** The same chrome without a person, shown while the session is read. */
export function ShellSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div className="min-h-dvh md:flex" aria-busy="true">
      <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col border-r border-hairline px-3 py-4 xl:flex">
        <Wordmark className="mx-1 mb-6" />
        <div className="flex flex-col gap-1.5 px-2.5">
          {[88, 110, 84, 64].map((w, i) => (
            <Skeleton key={i} className="my-2.5 h-3.5" width={w} />
          ))}
        </div>
      </aside>
      <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col items-center border-r border-hairline py-4 md:flex xl:hidden">
        <Wordmark compact className="mb-6 size-11 justify-center" />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center border-b border-hairline bg-canvas/95 px-4 md:hidden">
          <Wordmark />
        </header>
        <main className="px-4 pt-4 pb-24 md:px-6 md:pt-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
