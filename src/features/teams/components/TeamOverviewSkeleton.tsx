import { LoadingRegion, Skeleton, SkeletonCard } from "../../../components/ui/Skeleton";

/**
 * Layout-matched placeholder for `/teams/[teamId]`: the team header (identity square, name, metrics), the five tab
 * row, the four KPI cards and the two lower panels. Used by the route's `loading.tsx` and by `TeamDetail` while the
 * team's own reads are pending, so the page keeps the same shape from the first paint to the loaded view.
 *
 * Heights follow the loaded components (`TeamPageHeader`, `TeamOversiktSummary`); the region announces once and the
 * blocks are decorative.
 */
export function TeamOverviewSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-6">
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 shrink-0 rounded-surface sm:size-20" />
          <Skeleton className="h-8 w-2/3 max-w-xs" />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="flex gap-2 overflow-hidden">
          <Skeleton className="h-9 w-24 shrink-0" />
          <Skeleton className="h-9 w-28 shrink-0" />
          <Skeleton className="h-9 w-32 shrink-0" />
        </div>
      </div>

      <div aria-hidden="true" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonCard key={index} className="flex min-h-36 flex-col gap-3 p-6">
            <div className="flex items-start gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-8 w-12" />
            <Skeleton className="h-4 w-28" />
          </SkeletonCard>
        ))}
      </div>

      <div aria-hidden="true" className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <SkeletonCard className="flex min-h-56 flex-col gap-3 p-6">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-5/6" />
        </SkeletonCard>
        <SkeletonCard className="flex min-h-56 flex-col gap-3 p-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </SkeletonCard>
      </div>
    </LoadingRegion>
  );
}
