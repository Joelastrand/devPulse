import { LoadingRegion, Skeleton, SkeletonCard } from "../../../components/ui/Skeleton";

/**
 * Placeholder for the project roadmap: the toolbar row, then a timeline card with label-and-bar rows, matching the
 * loaded plan's structure. Blocks carry no text, dates or project names. One region announces loading.
 */
export function TeamRoadmapSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-4">
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-28" />
        </div>
        <SkeletonCard className="flex flex-col gap-4 p-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex items-center gap-4">
              <Skeleton className="h-5 w-40 shrink-0" />
              <Skeleton className="h-6 min-w-0 flex-1 rounded-control" />
            </div>
          ))}
        </SkeletonCard>
      </div>
    </LoadingRegion>
  );
}
