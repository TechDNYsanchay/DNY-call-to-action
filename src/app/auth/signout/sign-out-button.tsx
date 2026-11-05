import clsx from "clsx";
import type { ReactNode } from "react";

// A plain form post to /auth/signout: works from Server and Client Components alike, needs no JS,
// and a POST cannot be triggered by a stray link. The UI shell imports this for its menu.
export function SignOutButton({ className, children = "Sign out" }: { className?: string; children?: ReactNode }) {
  return (
    <form action="/auth/signout" method="post" className="inline">
      <button
        type="submit"
        className={clsx(
          "inline-flex h-9 items-center justify-center gap-2 rounded-chip px-3 text-[14px] font-medium text-ink-2 transition-colors hover:bg-raised hover:text-ink",
          className,
        )}
      >
        {children}
      </button>
    </form>
  );
}
