import { useId, type ReactNode } from "react";

export interface SectionProps {
  title: string;
  description?: string;
  /** Optional decorative icon (aria-hidden by the caller) shown before the title. */
  icon?: ReactNode;
  /** Optional secondary action for the section, placed beside the title. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * A page section (docs/archive/features/product-experience/SPEC.md — Section
 * hierarchy). Sections are separated by space rather than a border. The
 * region is labelled by its `h2`, so it is announced by name.
 */
export function Section({ title, description, icon, action, children }: SectionProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="flex items-center gap-2 text-section-title font-semibold text-text-primary">
            {icon}
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-body-secondary text-text-secondary">{description}</p>
          ) : null}
        </div>
        {action ? <div className="max-w-full">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
