import { ListSkeleton, PageTitleSkeleton, Skeleton } from "@/components/ui/skeleton";

// Matches the inbox: title, filter bar (two rows), two grouped lists.
export default function MeetingsLoading() {
  return (
    <div className="mx-auto max-w-[880px]">
      <PageTitleSkeleton />
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-[280px] lg:h-8" />
          <Skeleton className="h-9 w-40 lg:h-8" />
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
