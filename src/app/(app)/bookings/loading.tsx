import { ListSkeleton, PageTitleSkeleton } from "@/components/ui/skeleton";

export default function BookingsLoading() {
  return (
    <div className="mx-auto max-w-[880px]">
      <PageTitleSkeleton />
      <ListSkeleton rows={5} />
    </div>
  );
}
