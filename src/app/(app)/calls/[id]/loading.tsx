import { ActionRowSkeleton, Skeleton } from "@/components/ui/skeleton";

// The call page's shape at its real heights: the back link, the header, the player card, the sheet's first
// rows, and the rail on desktop. The player itself lives in the layout and is not part of this.
export default function CallLoading() {
  return (
    <div className="mx-auto flex max-w-[1212px] gap-8" aria-busy="true" aria-label="Loading the call">
      <div className="min-w-0 flex-1 xl:max-w-[880px]">
        <Skeleton className="mb-3 h-3" width={64} />
        <div className="flex flex-col gap-4">
          <div className="card p-5 sm:p-6 xl:p-8">
            <Skeleton className="h-8 xl:h-10" width="88%" />
            <Skeleton className="mt-2 h-8 xl:h-10" width="52%" />
            <div className="mt-4 flex flex-wrap gap-3">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-32" />
            </div>
          </div>
          <div className="card px-3 py-3 sm:px-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-11 rounded-full" />
              <Skeleton className="h-3" width={96} />
            </div>
            <Skeleton className="mt-3 h-1.5 rounded-full" />
            <Skeleton className="mt-3 h-[3px] rounded-full" />
            <div className="h-4" />
          </div>
          <div className="card p-5 sm:p-6 xl:p-8">
            <div className="grid grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-8 w-10 xl:h-10" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            <Skeleton className="mt-10 h-3.5 w-24" />
            <div className="mt-2 divide-y divide-hairline">
              {[0, 1, 2].map((i) => (
                <ActionRowSkeleton key={i} />
              ))}
            </div>
          </div>
        </div>
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
