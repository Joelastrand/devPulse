import type { HTMLAttributes } from "react";
import { cx } from "./class-names";
import { uiCopy } from "./copy";

export interface LoadingStateProps extends HTMLAttributes<HTMLParagraphElement> {
  /** Defaults to a generic Norwegian "Laster…" label; pass a specific one where it helps. */
  label?: string;
}

/**
 * Shared "loading X…" primitive replacing this codebase's ad hoc loading
 * paragraphs, per docs/features/product-ux-shell/SPEC.md BR-12.
 */
export function LoadingState({ label = uiCopy.loadingDefault, className, ...props }: LoadingStateProps) {
  return (
    <p role="status" className={cx("text-zinc-600 dark:text-zinc-400", className)} {...props}>
      {label}
    </p>
  );
}
