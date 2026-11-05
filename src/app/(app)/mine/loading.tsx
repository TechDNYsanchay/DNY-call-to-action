import { ListSkeleton, PageTitleSkeleton } from "@/components/ui/skeleton";

export default function MineLoading() {
  return (
    <div className="mx-auto max-w-[880px]">
      <PageTitleSkeleton />
      <div className="flex flex-col gap-4">
        <ListSkeleton rows={2} />
        <ListSkeleton rows={4} />
      </div>
    </div>
  );
}
