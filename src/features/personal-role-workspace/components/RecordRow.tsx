"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A compact, expandable row for one of the owner's own records (responsibilities, achievements). The summary line shows the
 * title, a short meta line, the status and one frequently used action, so the list can be scanned. The full text and the
 * less frequent actions open in the detail panel. The title is the disclosure button; the quick action sits beside it, so no
 * interactive control is nested inside another.
 */
export function RecordRow({
  title,
  meta,
  badge,
  quickAction,
  children,
}: {
  title: string;
  /** Short secondary line in the summary (for example relation or period). Omitted when there is nothing to show. */
  meta?: string;
  badge?: ReactNode;
  quickAction?: ReactNode;
  /** The detail panel content, rendered only while the row is expanded. */
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  return (
    <li className="rounded-md border border-border-subtle bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        {/* The heading names the record by its title only; the meta line sits beside the button, not inside it. */}
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-text-primary">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setExpanded((current) => !current)}
              className="flex min-h-11 w-full min-w-0 items-center justify-start break-words rounded-sm text-left focus-visible:outline-2 focus-visible:outline-primary"
            >
              {title}
            </button>
          </h3>
          {meta ? <p className="break-words text-xs text-text-secondary">{meta}</p> : null}
        </div>
        {badge}
        {quickAction}
      </div>
      {expanded ? (
        <div id={panelId} className="flex flex-col gap-3 border-t border-border-subtle px-3 py-3">
          {children}
        </div>
      ) : null}
    </li>
  );
}
