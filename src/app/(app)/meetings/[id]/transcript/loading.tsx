import { Skeleton } from "@/components/ui/skeleton";

// Transcript lines: timestamp column + speaker + one or two lines of text.
export default function TranscriptLoading() {
  return (
    <div className="mx-auto max-w-[880px]" aria-busy="true">
      <Skeleton className="mb-3 h-3" width={110} />
      <Skeleton className="h-6" width={120} />
      <Skeleton className="mt-2 h-3" width="55%" />
      <div className="card mt-4 divide-y divide-hairline">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex gap-4 px-4 py-2.5">
            <Skeleton className="h-3 w-[52px]" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3" width={90} />
              <Skeleton className="h-3.5" width={`${70 + ((i * 13) % 30)}%`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
