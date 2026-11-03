import type { ReactNode } from "react";

export type PageHeaderSize = "md" | "lg";

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Short context above the title (text, muted). */
  eyebrow?: string;
  /**
   * The page's one primary action. A single node, so a page cannot carry two.
   * Right-aligned on desktop and placed below the title on mobile.
   */
  primaryAction?: ReactNode;
  /** `lg` is Home's display size; `md` (default) is the page title size. */
  size?: PageHeaderSize;
}

const TITLE_SIZE_CLASSNAMES: Record<PageHeaderSize, string> = {
  md: "text-page-title font-semibold text-text-primary",
  lg: "text-metric font-semibold text-text-primary",
};

/**
 * Shared page-header primitive (docs/features/product-experience/SPEC.md —
 * Page composition). Always renders exactly one `<h1>`, the page's top-level
 * heading, and never a lower level. The eyebrow and primary action are
 * optional and text-led, so no page gets a second heading or a second action.
 */
export function PageHeader({ title, description, eyebrow, primaryAction, size = "md" }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="text-eyebrow text-text-muted">{eyebrow}</p> : null}
        <h1 className={TITLE_SIZE_CLASSNAMES[size]}>{title}</h1>
        {description ? (
          <p className="mt-1 text-page-description text-text-secondary">{description}</p>
        ) : null}
      </div>
      {primaryAction ? <div className="shrink-0">{primaryAction}</div> : null}
    </div>
  );
}
