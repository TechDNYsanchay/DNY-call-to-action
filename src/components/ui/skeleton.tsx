import clsx from "clsx";

// Skeletons match the final heights exactly so nothing jumps when data lands. Shimmer is static
// under reduced motion (globals.css).

export function Skeleton({ className, width }: { className?: string; width?: string | number }) {
  return <span aria-hidden="true" className={clsx("shimmer block rounded-[4px]", className)} style={width !== undefined ? { width } : undefined} />;
}

/** One inbox row: dot, name, minute line, counts. 56 px on phone, 48 px on desktop. */
export function RowSkeleton() {
  return (
    <div className="flex h-14 items-center gap-3 px-4 lg:h-12">
      <Skeleton className="size-2 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5" width="38%" />
        <Skeleton className="h-3" width="72%" />
      </div>
      <Skeleton className="h-3" width={56} />
    </div>
  );
}

/** One action row: checkbox, two text lines, pills. */
export function ActionRowSkeleton() {
  return (
    <div className="flex min-h-14 items-start gap-3 py-3 lg:min-h-11">
      <Skeleton className="mt-0.5 size-5 rounded-[4px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-3.5" width="64%" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-12 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 8, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div className="card divide-y divide-hairline" aria-busy="true" aria-label="Loading">
      {title && (
        <div className="px-4 py-2.5">
          <Skeleton className="h-3" width={120} />
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <RowSkeleton key={i} />
      ))}
    </div>
  );
}

/** The meeting sheet: minute (2 lines), meta, scoreboard, six action rows, three decisions. */
export function SheetSkeleton() {
  return (
    <div className="card p-5 sm:p-6 lg:p-8" aria-busy="true" aria-label="Loading the sheet">
      <Skeleton className="h-8 lg:h-10" width="92%" />
      <Skeleton className="mt-2 h-8 lg:h-10" width="60%" />
      <div className="mt-4 flex gap-3">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-36" />
      </div>
      <div className="mt-8 grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-8 w-10 lg:h-10" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="mt-10">
        <Skeleton className="h-3.5 w-24" />
        <div className="mt-2 divide-y divide-hairline">
          {Array.from({ length: 4 }, (_, i) => (
            <ActionRowSkeleton key={i} />
          ))}
        </div>
      </div>
      <div className="mt-8">
        <Skeleton className="h-3.5 w-28" />
        <div className="mt-2 divide-y divide-hairline">
          {Array.from({ length: 2 }, (_, i) => (
            <ActionRowSkeleton key={i} />
          ))}
        </div>
      </div>
      <div className="mt-8">
        <Skeleton className="h-3.5 w-24" />
        <div className="mt-3 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-3.5" width={`${80 - i * 12}%`} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function PageTitleSkeleton() {
  return (
    <div className="mb-4 flex h-9 items-center">
      <Skeleton className="h-5" width={160} />
    </div>
  );
}
