import type { ButtonHTMLAttributes, Ref } from "react";
import { cx } from "./class-names";

/**
 * Action hierarchy (docs/features/product-experience/SPEC.md — Action
 * hierarchy). `destructive` is for dialogs and danger areas only.
 */
export type ButtonVariant = "primary" | "secondary" | "tertiary" | "destructive";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** React 19 passes ref as a prop; the shell uses it to return focus to its trigger. */
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * True while the action this button triggers is in flight. Disables the
   * button (in addition to any explicit `disabled`) and marks it
   * `aria-busy` — the pending *label* (e.g. "Lagrer…") stays the caller's
   * responsibility via `children`, since only the caller knows the
   * in-progress wording for its own action.
   */
  pending?: boolean;
}

// Focus is owned by the global :focus-visible rule in app/globals.css and is
// not restated here, so no button can remove it.
const BASE_CLASSNAME =
  "rounded-control transition-colors duration-micro ease-standard disabled:cursor-not-allowed disabled:opacity-50";

const VARIANT_CLASSNAMES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-text hover:bg-primary-hover",
  secondary: "border border-border-strong text-text-primary hover:bg-surface-subtle",
  tertiary: "text-primary hover:bg-primary-subtle",
  destructive: "border border-danger-text text-danger-text hover:bg-danger-subtle",
};

const SIZE_CLASSNAMES: Record<ButtonSize, string> = {
  md: "px-5 py-2.5 text-sm font-medium",
  sm: "px-4 py-1.5 text-sm font-medium",
};

export interface ButtonClassNameOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/**
 * Returns the exact class string `Button` itself renders for a given
 * variant/size, for the one legitimate case a control needs identical
 * button-like styling without being a `<button>` — an internal navigation
 * link that's visually a "button" (e.g. Home's call-to-action links).
 * Prefer `Button` itself whenever the control performs an action; use this
 * only to avoid rendering an invalid nested/impersonating interactive
 * element while keeping a `Link`'s real anchor semantics
 * (docs/features/product-ux-shell/SPEC.md — TASK-003 guidance, applied by
 * TASK-006).
 */
export function buttonClassName({
  variant = "primary",
  size = "md",
  className,
}: ButtonClassNameOptions = {}): string {
  return cx(BASE_CLASSNAME, VARIANT_CLASSNAMES[variant], SIZE_CLASSNAMES[size], className);
}

/**
 * Shared button primitive covering this codebase's three existing visual
 * treatments (primary/secondary/destructive) at the two sizes actually in
 * use (form/hero-sized `md`, compact row-action `sm`) — see
 * docs/features/product-ux-shell/SPEC.md BR-9. Native `<button>` semantics
 * and props (including `type`, `disabled`, `onClick`) pass through
 * unchanged; `type` defaults to `"button"` so a button never implicitly
 * submits an enclosing form unless a caller opts in with `type="submit"`.
 */
export function Button({
  variant = "primary",
  size = "md",
  pending = false,
  disabled,
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClassName({ variant, size, className })}
      {...props}
    />
  );
}
