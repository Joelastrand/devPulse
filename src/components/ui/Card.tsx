import type { HTMLAttributes } from "react";
import { cx } from "./class-names";

export type CardVariant = "bordered" | "elevated" | "nested";
export type CardPadding = "sm" | "md" | "lg";
export type CardElement = "div" | "li" | "section";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** `bordered` (list-row / result-summary panel) or `elevated` (auth/survey-form panel). */
  variant?: CardVariant;
  padding?: CardPadding;
  /**
   * The rendered tag. Cards are presentation-only, so the semantic element
   * stays the caller's choice: `li` for a list row, `section` for a
   * labelled panel (pair with `aria-labelledby`/`aria-label`), `div`
   * otherwise.
   */
  as?: CardElement;
}

const VARIANT_CLASSNAMES: Record<CardVariant, string> = {
  bordered: "rounded-surface border border-border-subtle bg-surface shadow-card",
  elevated: "rounded-surface bg-surface shadow-elevated",
  // A surface inside a bordered surface uses a fill, not a second border (SPEC: Spacing, radii, borders, elevation).
  nested: "rounded-control bg-surface-subtle",
};

const PADDING_CLASSNAMES: Record<CardPadding, string> = {
  sm: "px-4 py-3",
  md: "p-6",
  lg: "p-8",
};

/**
 * Shared "bordered rounded box" primitive consolidating this codebase's
 * three near-duplicate panel treatments — list-row card (`bordered`/`sm`),
 * result-summary panel (`bordered`/`md`), and auth/survey-form panel
 * (`elevated`/`lg`) — per docs/features/product-ux-shell/SPEC.md BR-10. No
 * business logic; purely a styled container.
 */
export function Card({
  as = "div",
  variant = "bordered",
  padding = "md",
  className,
  ...props
}: CardProps) {
  const Component = as;
  return (
    <Component
      className={cx(VARIANT_CLASSNAMES[variant], PADDING_CLASSNAMES[padding], className)}
      {...props}
    />
  );
}
