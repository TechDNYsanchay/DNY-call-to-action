import { SheetSkeleton, Skeleton } from "@/components/ui/skeleton";

// The sheet skeleton (minute, meta, scoreboard, lanes, decisions) plus the context rail on desktop.
export default function MeetingLoading() {
  return (
    <div className="mx-auto flex max-w-[1212px] gap-8">
      <div className="min-w-0 flex-1 lg:max-w-[880px]">
        <Skeleton className="mb-3 h-3" width={80} />
        <SheetSkeleton />
      </div>
      <aside className="hidden w-[300px] shrink-0 xl:block" aria-hidden="true">
        <div className="card p-4">
          <Skeleton className="h-3" width={80} />
          <Skeleton className="mt-3 h-9" />
          <Skeleton className="mt-6 h-3" width={70} />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="mt-3 h-6" width={`${90 - i * 15}%`} />
          ))}
        </div>
      </aside>
    </div>
  );
}
