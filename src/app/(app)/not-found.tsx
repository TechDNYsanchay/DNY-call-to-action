import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

// A meeting or client that does not exist (or was removed), shown inside the shell.
export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-[880px]">
      <EmptyState
        title="There is nothing at this address."
        action={
          <Link href="/meetings" className={buttonClass("secondary")}>
            Go to meetings
          </Link>
        }
      >
        The link may be old, or the meeting may have been removed.
      </EmptyState>
    </div>
  );
}
