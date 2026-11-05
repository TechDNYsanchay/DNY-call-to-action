import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

// Client page: serif name (26 px), meta line, two lanes, meeting list.
export default function ClientLoading() {
  return (
    <div className="mx-auto max-w-[880px]">
      <Skeleton className="mb-2 h-3" width={60} />
      <Skeleton className="h-8" width="40%" />
      <Skeleton className="mt-2 h-3.5" width="60%" />
      <div className="mt-6 flex flex-col gap-4">
        <ListSkeleton rows={3} />
        <ListSkeleton rows={2} />
        <ListSkeleton rows={4} />
      </div>
    </div>
  );
}
