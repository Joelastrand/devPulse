import type { ButtonHTMLAttributes } from "react";
import { cx } from "./class-names";

export type ButtonVariant = "primary" | "secondary" | "destructive";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
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

const BASE_CLASSNAME =
  "rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const VARIANT_CLASSNAMES: Record<ButtonVariant, string> = {
  primary: "bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc]",
  secondary:
    "border border-zinc-300 text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900",
  destructive:
    "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
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
