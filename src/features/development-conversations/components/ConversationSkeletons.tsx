import { LoadingRegion, Skeleton, SkeletonText } from "../../../components/ui/Skeleton";

/**
 * Layout-matched placeholders for the personal conversation pages. Each mirrors the loaded layout (intro, create form,
 * filter chips and list rows for the overview; back link, title, metadata and body for the detail) so the content does
 * not jump when it arrives. Blocks are decorative; the region announces loading once.
 */

const LIST_ROWS = 3;

/** Placeholder for `/me/conversations` while the owner and participation lists are read. */
export function ConversationsListSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-6">
      <div aria-hidden="true" className="flex flex-col gap-6">
        <SkeletonText lines={2} className="max-w-prose" />

        {/* CreateConversationForm renders only a toggle button while closed, so the placeholder is one button-sized block. */}
        <div>
          <Skeleton className="h-9 w-36" />
        </div>

        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-24 rounded-full" />
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-32" />
          <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface">
            {Array.from({ length: LIST_ROWS }, (_, index) => (
              <li key={index} className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
                <Skeleton className="h-4 w-1/2" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </LoadingRegion>
  );
}

/**
 * Compact placeholder for a checkbox-list selector (evidence, goals) while its options are read. Rows match the loaded
 * label-and-checkbox rows, so the form keeps its height. Decorative; the region carries the one announcement.
 */
export function SelectorOptionsSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-2">
      <div aria-hidden="true" className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-2 py-1">
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/**
 * Compact placeholder for a single dropdown control (colleague picker) while its options are read. The loaded `Select`
 * has a label line above a full-width control, so the placeholder reserves both.
 */
export function SelectorControlSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-2">
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-full" />
      </div>
    </LoadingRegion>
  );
}

/** Placeholder for `/me/conversations/[id]` while the conversation read is pending. */
export function ConversationDetailSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex min-w-0 flex-col gap-6">
      {/* The back link is rendered by ConversationDetail outside this body, so it is not repeated here. */}
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-6">
        {/* Shared header of both views: privacy line, then status and a date or name line, then the participant line. */}
        <div className="flex max-w-prose flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-4 w-48 max-w-full" />
        </div>

        {/* ConversationSectionTabs: a row of tab buttons that may scroll on narrow screens. */}
        <div className="flex gap-2 overflow-hidden">
          <Skeleton className="h-9 w-28 shrink-0" />
          <Skeleton className="h-9 w-28 shrink-0" />
          <Skeleton className="h-9 w-24 shrink-0" />
        </div>

        {/*
         * One generic section: a heading and two text lines. The viewer's role is not known until the read finishes,
         * so the placeholder shows no input or save control that only the owner or only a participant would have.
         */}
        <section className="flex min-w-0 flex-col gap-4">
          <Skeleton className="h-6 w-40" />
          <SkeletonText lines={2} />
        </section>
      </div>
    </LoadingRegion>
  );
}
