import { PageTitleSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-[960px]">
      <PageTitleSkeleton />
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card p-5">
            <Skeleton className="h-3.5" width={120} />
            <Skeleton className="mt-4 h-10" />
            <Skeleton className="mt-2 h-10" />
            <Skeleton className="mt-2 h-10" width="70%" />
          </div>
        ))}
      </div>
    </div>
  );
}
