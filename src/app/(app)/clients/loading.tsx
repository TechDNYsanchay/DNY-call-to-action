import { ListSkeleton, PageTitleSkeleton } from "@/components/ui/skeleton";

export default function ClientsLoading() {
  return (
    <div className="mx-auto max-w-[880px]">
      <PageTitleSkeleton />
      <ListSkeleton rows={6} title={false} />
    </div>
  );
}
