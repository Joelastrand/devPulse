import type { HTMLAttributes } from "react";
import { cx } from "./class-names";

export interface EmptyStateProps extends HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode;
}

/**
 * Shared "no X yet" primitive replacing this codebase's ad hoc empty-list
 * paragraphs, per docs/features/product-ux-shell/SPEC.md BR-12. `role`
 * defaults to `status`, matching every existing instance — an empty list is
 * a non-urgent state, not an error.
 */
export function EmptyState({ className, children, ...props }: EmptyStateProps) {
  return (
    <p role="status" className={cx("text-zinc-600 dark:text-zinc-400", className)} {...props}>
      {children}
    </p>
  );
}
