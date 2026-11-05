import { Suspense } from "react";
import { requireUser } from "@/lib/auth/require-user";
import { countNeedsDecision } from "@/lib/data/meetings";
import { AppShell, ShellSkeleton } from "@/components/shell/app-shell";

// Every signed-in screen. The session read happens at request time, so it sits behind a Suspense
// boundary (Cache Components): the chrome streams in as soon as the person is known, and each
// page has its own loading.tsx for its data.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const { person, isAdmin } = await requireUser();
  const reviewCount = await countNeedsDecision().catch(() => 0);
  return (
    <AppShell person={person} isAdmin={isAdmin} reviewCount={reviewCount}>
      {children}
    </AppShell>
  );
}
