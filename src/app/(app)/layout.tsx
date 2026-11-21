import { Suspense } from "react";
import { requireUser } from "@/lib/auth/require-user";
import { callsNav } from "@/lib/data/calls";
import { countNeedsDecision } from "@/lib/data/meetings";
import { AppShell, ShellSkeleton } from "@/components/shell/app-shell";

// Every signed-in screen. The session read happens at request time, so it sits behind a Suspense
// boundary (Cache Components): the chrome streams in as soon as the person is known, and each
// page has its own loading.tsx for its data. The meetings badge and the Calls item (shown once a
// phone line is on, with its own badge) are read side by side.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const { person, isAdmin } = await requireUser();
  const [reviewCount, calls] = await Promise.all([countNeedsDecision().catch(() => 0), callsNav()]);
  return (
    <AppShell person={person} isAdmin={isAdmin} reviewCount={reviewCount} calls={calls}>
      {children}
    </AppShell>
  );
}
