import { ListSkeleton, PageTitleSkeleton } from "@/components/ui/skeleton";

export default function ReviewLoading() {
  return (
    <div className="mx-auto max-w-[880px]">
      <PageTitleSkeleton />
      <div className="flex flex-col gap-4">
        <ListSkeleton rows={3} />
        <ListSkeleton rows={2} />
      </div>
    </div>
  );
}
