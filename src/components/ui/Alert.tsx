import type { HTMLAttributes } from "react";
import { cx } from "./class-names";

export type AlertVariant = "success" | "error" | "info";

export interface AlertProps extends HTMLAttributes<HTMLParagraphElement> {
  variant?: AlertVariant;
}

const VARIANT_CONFIG: Record<AlertVariant, { role: "status" | "alert"; className: string }> = {
  // Matches this codebase's existing inline success-confirmation treatment
  // (e.g. SignInForm/SignUpForm's "Signed in." / "Account created." text).
  success: { role: "status", className: "text-zinc-900 dark:text-zinc-50" },
  // Matches the existing neutral status-paragraph treatment.
  info: { role: "status", className: "text-zinc-600 dark:text-zinc-400" },
  // Matches the existing inline error-paragraph treatment.
  error: { role: "alert", className: "text-red-700 dark:text-red-400" },
};

/**
 * Shared status/error-message primitive replacing this codebase's inline
 * status/error paragraphs, per docs/features/product-ux-shell/SPEC.md
 * BR-11. Uses `role="alert"` for `error` (assertive) and `role="status"`
 * for `success`/`info` (polite) — matching the accessibility semantics
 * every existing instance already uses. Never maps or rewrites the message
 * itself: the caller's `children` is rendered verbatim, so a domain error
 * is never mapped inside this generic primitive.
 */
export function Alert({ variant = "info", className, children, ...props }: AlertProps) {
  const { role, className: variantClassName } = VARIANT_CONFIG[variant];
  return (
    <p role={role} className={cx(variantClassName, className)} {...props}>
      {children}
    </p>
  );
}
