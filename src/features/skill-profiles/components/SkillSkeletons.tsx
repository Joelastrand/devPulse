import { LoadingRegion, Skeleton, SkeletonText } from "../../../components/ui/Skeleton";

/**
 * Placeholders for the personal skills views. Each reserves the final layout: the three summary tiles and the radar box
 * (same height as the lazy radar's own loading box) for the overview, and a heading plus skill rows for the editing view.
 * Decorative and hidden from assistive technology; the owning `LoadingRegion` makes the single announcement.
 */

const TILE = "flex flex-col gap-2 rounded-surface border border-border-subtle bg-surface p-4";

export function SkillOverviewSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="space-y-6">
      <div aria-hidden="true" className="space-y-6">
        <ul className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <li key={index} className={`${TILE} min-h-[6.5rem]`}>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-7 w-1/3" />
            </li>
          ))}
        </ul>
        {/* Same box as the lazy radar's loading placeholder, so the chart does not move when it mounts. */}
        <Skeleton className="mx-auto h-[300px] w-full max-w-[360px]" />
      </div>
    </LoadingRegion>
  );
}

export function SkillListSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <LoadingRegion label={label}>
      <div aria-hidden="true" className="flex flex-col gap-3 rounded-surface border border-border-subtle bg-surface p-4">
        <Skeleton className="h-6 w-1/3" />
        <ul className="flex flex-col divide-y divide-border-subtle">
          {Array.from({ length: rows }, (_, index) => (
            <li key={index} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between md:gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-1/2" />
                <SkeletonText lines={1} className="w-1/3" />
              </div>
              <Skeleton className="h-8 w-40 md:shrink-0" />
            </li>
          ))}
        </ul>
      </div>
    </LoadingRegion>
  );
}
