import { PageTitleSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function NewBookingLoading() {
  return (
    <div className="mx-auto max-w-[720px]">
      <PageTitleSkeleton />
      <div className="card flex flex-col gap-5 p-5 sm:p-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton width={120} className="h-3" />
            <Skeleton className="h-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
