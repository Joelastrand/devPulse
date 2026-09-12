import type { ReactNode } from "react";
import { cx } from "./class-names";

export type PageShellWidth = "sm" | "lg" | "2xl" | "3xl";

export interface PageShellProps {
  children: ReactNode;
  /** Matches Tailwind's `max-w-*` scale already used across existing pages. */
  width?: PageShellWidth;
  /** Vertically centers content — the existing treatment for short auth/survey-form pages. */
  center?: boolean;
  className?: string;
}

const WIDTH_CLASSNAMES: Record<PageShellWidth, string> = {
  sm: "max-w-sm",
  lg: "max-w-lg",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
};

/**
 * Shared application page-shell primitive: the outer centered container +
 * `<main>` landmark every existing route currently hand-duplicates, per
 * docs/features/product-ux-shell/SPEC.md BR-8. `center` reproduces the
 * existing vertically-centered treatment used by the sign-in/sign-up/pulse-
 * survey pages; every other existing page top-aligns (`center` omitted).
 */
export function PageShell({ children, width = "3xl", center = false, className }: PageShellProps) {
  return (
    <div
      className={cx(
        "flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black",
        center && "items-center",
      )}
    >
      <main className={cx("w-full", WIDTH_CLASSNAMES[width], className)}>{children}</main>
    </div>
  );
}
