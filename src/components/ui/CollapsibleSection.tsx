"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "./Button";
import { uiCopy } from "./copy";
import { Icon } from "./Icon";
import { cx } from "./class-names";

export interface CollapsibleSectionProps {
  /** Stable, unique within the page. Used for the DOM ids of the header and panel. */
  id: string;
  title: string;
  description?: string;
  /** Shown only while collapsed, so a closed section still says what it contains (for example a count). */
  summary?: ReactNode;
  /** Decorative icon, shown before the title. */
  icon?: ReactNode;
  /** 2 for a page-level section, 3 for a section inside another section. */
  headingLevel?: 2 | 3;
  /** Controlled expanded state. Omit it to use `defaultOpen` (uncontrolled). */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Keeps the section expanded and its toggle disabled while an active workflow is open in it (for example an editor
   * with unsaved input). Collapsing is not offered until the workflow ends.
   */
  lockOpen?: boolean;
  /** Secondary actions. They sit beside the header, outside the toggle button, so no interactive element is nested. */
  actions?: ReactNode;
  /** A status indicator, such as a badge. Always visible. */
  status?: ReactNode;
  children: ReactNode;
}

/**
 * A disclosure section for secondary content (docs/archive/features/product-experience/SPEC.md — progressive disclosure).
 * The header is a real heading that contains one `button` with `aria-expanded` and `aria-controls`. The content stays
 * mounted and is hidden with the `hidden` attribute while collapsed, so it is out of the keyboard and assistive-technology
 * order, and an open form keeps its input. Chart and timeline state is not lost on each toggle.
 */
export function CollapsibleSection({
  id,
  title,
  description,
  summary,
  icon,
  headingLevel = 2,
  open,
  defaultOpen = false,
  onOpenChange,
  lockOpen = false,
  actions,
  status,
  children,
}: CollapsibleSectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const expanded = lockOpen || (isControlled ? open : uncontrolledOpen);
  const headingId = `${id}-heading`;
  const buttonId = `${id}-toggle`;
  const panelId = `${id}-panel`;
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const summaryId = `${id}-summary`;
  // The toggle's name is the title alone. The description and the collapsed summary are descriptions, so a screen reader
  // announces them after the name rather than as part of it.
  const describedBy = [description ? descriptionId : null, !expanded && summary ? summaryId : null].filter(Boolean).join(" ") || undefined;
  const Heading = headingLevel === 3 ? "h3" : "h2";

  function toggle() {
    if (lockOpen) return;
    const next = !expanded;
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  return (
    <section className="min-w-0 rounded-surface border border-border-subtle bg-surface shadow-card">
      <div className="flex items-start gap-3 px-4 py-3">
        <Heading id={headingId} className="min-w-0 flex-1 text-section-title font-semibold text-text-primary">
          <button
            type="button"
            id={buttonId}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-labelledby={titleId}
            aria-describedby={describedBy}
            disabled={lockOpen}
            onClick={toggle}
            className="flex min-h-11 w-full min-w-0 items-start gap-3 rounded-control py-1 text-left font-normal disabled:cursor-default"
          >
            {icon ? (
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-primary">
                {icon}
              </span>
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span id={titleId} className="break-words font-semibold text-text-primary">
                {title}
              </span>
              {description ? (
                <span id={descriptionId} className="text-help text-text-secondary">
                  {description}
                </span>
              ) : null}
              {!expanded && summary ? (
                <span id={summaryId} className="text-help font-medium text-text-secondary">
                  {summary}
                </span>
              ) : null}
            </span>
            {status ? <span className="shrink-0">{status}</span> : null}
            <Icon
              icon={ChevronDown}
              size="action"
              className={cx(
                "mt-1 shrink-0 text-text-secondary motion-safe:transition-transform motion-safe:duration-panel motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
            />
          </button>
        </Heading>
        {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </div>
      <div
        id={panelId}
        role="region"
        aria-labelledby={titleId}
        hidden={!expanded}
        className="border-t border-border-subtle px-4 py-4"
      >
        {children}
      </div>
    </section>
  );
}

export interface CollapsibleSectionGroupProps {
  /** Accessible name of the group controls. */
  label: string;
  /** The number of collapsible sections this group controls. The controls appear only with three or more. */
  sectionCount: number;
  /** Applies one expanded state to every section the group controls. */
  onSetAll: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Wraps a page's collapsible sections and offers `Vis alle` / `Skjul alle`. Sections stay independent: several may be open
 * at once. The group contains only sections, never mandatory notices or primary actions, which stay outside it.
 */
export function CollapsibleSectionGroup({ label, sectionCount, onSetAll, children }: CollapsibleSectionGroupProps) {
  return (
    <div className="flex flex-col gap-4">
      {sectionCount >= 3 ? (
        <div role="group" aria-label={label} className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="tertiary" size="sm" onClick={() => onSetAll(true)}>
            {uiCopy.collapsible.showAll}
          </Button>
          <Button type="button" variant="tertiary" size="sm" onClick={() => onSetAll(false)}>
            {uiCopy.collapsible.hideAll}
          </Button>
        </div>
      ) : null}
      {children}
    </div>
  );
}
