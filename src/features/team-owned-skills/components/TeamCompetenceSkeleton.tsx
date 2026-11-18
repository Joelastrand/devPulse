import { LoadingRegion, Skeleton, SkeletonCard } from "../../../components/ui/Skeleton";

/**
 * Placeholder for the Teamkompetanse page in its loaded order: heading and intro, the automatic/collaborative mode
 * toggle, the radar and bar chart areas (at the same heights the loaded charts use), and the table. The blocks carry no
 * text, values or area names, so nothing about suppressed or unauthorized competency data can appear while loading.
 * One region announces loading.
 */
export function TeamCompetenceSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-6">
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-40" />
        </div>
        <Skeleton className="h-5 w-64" />
        <div className="grid gap-6 lg:grid-cols-2">
          <SkeletonCard className="min-h-[320px] p-4">
            <Skeleton className="mx-auto h-[280px] w-full max-w-[420px] min-w-[260px]" />
          </SkeletonCard>
          <SkeletonCard className="min-h-[320px] p-4">
            <Skeleton className="h-[280px] w-full" />
          </SkeletonCard>
        </div>
        <SkeletonCard className="min-h-48 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-3 h-8 w-full" />
          <Skeleton className="mt-3 h-8 w-5/6" />
        </SkeletonCard>
      </div>
    </LoadingRegion>
  );
}
