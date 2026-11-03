import type { HTMLAttributes } from "react";
import { CircleCheck, CircleDot, CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { Icon } from "./Icon";
import { cx } from "./class-names";

/**
 * Status presentation (docs/features/product-experience/SPEC.md — Status
 * representation). Every status is an icon, a text label and a tone. The icon
 * is decorative because the text carries the meaning, so the status is never
 * conveyed by colour alone. The caller decides the tone from its existing
 * state; this component derives nothing.
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusTone;
};

const BASE_CLASSNAME =
  "inline-flex items-center gap-1 rounded-field border px-2 py-0.5 text-help font-medium";

const TONE_CLASSNAMES: Record<StatusTone, string> = {
  success: "border-transparent bg-success-subtle text-success-text",
  warning: "border-transparent bg-warning-subtle text-warning-text",
  danger: "border-transparent bg-danger-subtle text-danger-text",
  info: "border-transparent bg-info-subtle text-info-text",
  neutral: "border-border-subtle bg-surface-subtle text-text-secondary",
};

const TONE_ICONS: Record<StatusTone, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
  info: Info,
  neutral: CircleDot,
};

export function StatusBadge({ tone = "neutral", className, children, ...props }: StatusBadgeProps) {
  return (
    <span className={cx(BASE_CLASSNAME, TONE_CLASSNAMES[tone], className)} {...props}>
      <Icon icon={TONE_ICONS[tone]} size="inline" />
      {children}
    </span>
  );
}
