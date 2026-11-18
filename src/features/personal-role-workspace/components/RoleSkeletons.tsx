import { LoadingRegion, Skeleton, SkeletonText } from "../../../components/ui/Skeleton";

/**
 * Placeholders for the personal role workspace. They mirror the loaded shapes: a bordered card with a title row, two text
 * lines and an action row (responsibilities and achievements), and the heading plus two lines of the formal role. Built
 * only from the shared primitives; the owning `LoadingRegion` makes the single announcement.
 */

const PLACEHOLDER_CARD = "space-y-2 rounded-surface border border-border-subtle bg-surface p-4";

/** Loading list of owner records: one busy region, decorative cards with the final heights. */
export function RecordListSkeleton({ label, rows = 2 }: { label: string; rows?: number }) {
  return (
    <LoadingRegion label={label} className="space-y-3">
      <ul aria-hidden="true" className="space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index}>
            <div className={PLACEHOLDER_CARD}>
              <div className="flex items-start justify-between gap-2">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-5 w-16" />
              </div>
              <SkeletonText lines={2} />
              <div className="flex flex-wrap gap-2 pt-1">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-24" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </LoadingRegion>
  );
}

/** Loading "Min rolle" body: the heading stays outside; these lines reserve the title and description space. */
export function FormalRoleSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="space-y-2">
      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <SkeletonText lines={2} />
      </div>
    </LoadingRegion>
  );
}
