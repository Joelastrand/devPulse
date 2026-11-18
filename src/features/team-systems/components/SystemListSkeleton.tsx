import { LoadingRegion, Skeleton, SkeletonCard } from "../../../components/ui/Skeleton";

/**
 * Placeholder for the systems list: the filter row, then three system cards in the loaded card layout (name, metadata,
 * classification badges, attribute row). The blocks are plain surfaces with no text, so no classification value or
 * competency rating can be read from them. One region announces loading.
 */
export function SystemListSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-4">
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full sm:w-72" />
        {Array.from({ length: 3 }, (_, index) => (
          <SkeletonCard key={index} className="flex flex-col gap-3 p-4">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </LoadingRegion>
  );
}
