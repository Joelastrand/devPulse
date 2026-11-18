import { LoadingRegion, Skeleton } from "../../../components/ui/Skeleton";

/**
 * Layout-matched placeholders for the team administration views and the team pages around them. Each one follows the
 * loaded component's structure (plain sections or card grids, not generic cards) so the page keeps its shape when data
 * arrives. Blocks are decorative; the region announces loading once.
 */

/**
 * Bordered row placeholder that matches the loaded invitation and request cards: two text lines on the left and one
 * action button on the right.
 */
function AdminRowSkeleton() {
  return (
    <li className="flex items-center justify-between gap-4 rounded-surface border border-border-subtle bg-surface p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-3 w-32 max-w-full" />
      </div>
      <Skeleton className="h-8 w-20 shrink-0" />
    </li>
  );
}

/**
 * Placeholder for the superadmin team detail. Loaded, it is a header, a row of team facts, then plain sections in this
 * order: invitation form, members, roles, pending invitations, requests, surveys, challenges, skills. Each section gets
 * the rows, description lines or controls it shows when loaded. Nothing here is a control the viewer cannot use.
 */
export function AdminTeamDetailSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-6">
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-1/2 max-w-sm" />
          <Skeleton className="h-4 w-1/3" />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-4 w-24" />
          ))}
        </div>

        <section className="flex flex-col gap-4">
          <Skeleton className="h-6 w-40" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 w-28 shrink-0" />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Skeleton className="h-6 w-36" />
          <ul className="flex flex-col gap-3">
            {Array.from({ length: 3 }, (_, index) => (
              <li key={index} className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <Skeleton className="h-4 w-36 max-w-full" />
                </div>
                <Skeleton className="h-8 w-24" />
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-3/4" />
          <ul className="flex flex-col gap-2">
            {Array.from({ length: 2 }, (_, index) => (
              <li key={index} className="flex flex-wrap items-center justify-between gap-2">
                <Skeleton className="h-4 w-36 max-w-full" />
                <Skeleton className="h-10 w-40 max-w-full" />
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <Skeleton className="h-6 w-40" />
          <ul className="flex flex-col gap-3">
            <AdminRowSkeleton />
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <Skeleton className="h-6 w-36" />
          <ul className="flex flex-col gap-3">
            <AdminRowSkeleton />
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-8 w-32 shrink-0" />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <Skeleton className="h-6 w-44" />
          <ul className="flex flex-col gap-3">
            {Array.from({ length: 2 }, (_, index) => (
              <li key={index} className="flex flex-col gap-2 rounded-surface border border-border-subtle bg-surface p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-10 w-48 max-w-full" />
        </section>
      </div>
    </LoadingRegion>
  );
}

/**
 * Placeholder for the superadmin team list. Loaded, it is a card grid (one card per team) with the same breakpoints:
 * one column on mobile, two from `md`, three from `xl`.
 */
export function AdminTeamsListSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label}>
      <ul aria-hidden="true" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <li key={index} className="flex flex-col gap-3 rounded-surface border border-border-subtle bg-surface p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 shrink-0 rounded-surface" />
              <Skeleton className="h-5 w-2/3" />
            </div>
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </li>
        ))}
      </ul>
    </LoadingRegion>
  );
}

/** Placeholder for the team roster list. Rows match the avatar-and-name layout of the loaded roster. */
export function TeamRosterSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-2">
      <ul aria-hidden="true" className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index} className="flex items-center gap-2">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-40 max-w-full" />
          </li>
        ))}
      </ul>
    </LoadingRegion>
  );
}

/**
 * Metric placeholder for an overview KPI card (for example "active plans"). It carries no status role: the sibling
 * "next steps" panel announces loading for the same read, so announcing twice would repeat the message.
 */
export function TeamMetricSkeleton() {
  return (
    <div aria-hidden="true" aria-busy="true" className="flex flex-col gap-2">
      <Skeleton className="h-8 w-12" />
      <Skeleton className="h-4 w-28" />
    </div>
  );
}

/** Next-steps list placeholder: the bordered step rows of the loaded roadmap panel. */
export function TeamNextStepsSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col">
      <ol aria-hidden="true" className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <li key={index} className="flex flex-col gap-1 border-l-2 border-border-subtle pl-3">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </li>
        ))}
      </ol>
    </LoadingRegion>
  );
}

/** Card grid placeholder for the teams overview; the same columns as the loaded `TeamsOverview` list. */
export function TeamsGridSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label}>
      <ul aria-hidden="true" className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <li key={index} className="flex flex-col overflow-hidden rounded-surface border border-border-subtle bg-surface">
            <Skeleton className="h-24 w-full rounded-none" />
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-9 w-28" />
            </div>
          </li>
        ))}
      </ul>
    </LoadingRegion>
  );
}

/** Heading placeholder for the public team page while the team is read. */
export function PublicTeamHeadingSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label}>
      <Skeleton aria-hidden="true" className="h-8 w-1/2 max-w-xs" />
    </LoadingRegion>
  );
}

/** Settings placeholder for team visibility: the status line, an explanation and the action button. */
export function VisibilitySettingsSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-3">
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-9 w-40" />
      </div>
    </LoadingRegion>
  );
}
