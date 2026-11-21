import { ListSkeleton, PageTitleSkeleton, Skeleton } from "@/components/ui/skeleton";

// Matches the Calls list: title, the status line, the filters (chips and selects, then the search), and two
// grouped lists.
export default function CallsLoading() {
  return (
    <div className="mx-auto max-w-[880px]">
      <PageTitleSkeleton />
      <Skeleton className="mb-4 h-[18px]" width="72%" />
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-[320px] lg:h-8" />
          <Skeleton className="hidden h-9 w-36 md:block lg:h-8" />
        </div>
        <Skeleton className="h-11 lg:h-9" />
      </div>
      <div className="flex flex-col gap-4">
        <ListSkeleton rows={2} />
        <ListSkeleton rows={6} />
      </div>
    </div>
  );
}
