import { LoadingRegion, Skeleton, SkeletonCard, SkeletonText } from "../../../components/ui/Skeleton";

/**
 * Placeholder for the loaded Kompetanseplan section (CompetencePlanSection): heading and intro, the link row, the plan
 * overview, then the plan cards with their progress rows. Each block reserves the height of its loaded counterpart so the
 * page does not jump when the data arrives. The blocks carry no text, so no plan title, status or step can be read from
 * them. One region announces loading.
 */
export function CompetencePlanSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-8">
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-56" />
        <SkeletonText lines={2} />
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-36" />
        </div>
      </div>

      <SkeletonCard className="flex flex-col gap-4 p-4">
        <Skeleton className="h-5 w-40" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
      </SkeletonCard>

      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-5 w-36" />
        {Array.from({ length: 2 }, (_, index) => (
          <SkeletonCard key={index} className="flex flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="size-9 shrink-0 rounded-field" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-28 rounded-full" />
                </div>
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-2 flex-1 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="size-8 shrink-0" />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </LoadingRegion>
  );
}
