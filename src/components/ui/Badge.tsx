import type { HTMLAttributes } from "react";
import { cx } from "./class-names";

export type BadgeProps = HTMLAttributes<HTMLSpanElement>;

const BASE_CLASSNAME =
  "inline-flex items-center rounded-field border border-border-subtle bg-surface px-2 py-0.5 text-help font-medium text-text-secondary";

/**
 * Shared calm, operational status/relationship-text treatment
 * (docs/archive/features/ui-refresh/SPEC.md — BR-10), replacing this codebase's
 * previously plain-text status labels (team active/disabled, a team's
 * relationship, challenge status, skill-tracking not-started/disabled).
 * `children` is always the status text itself — this component has no
 * color-only mode and no `tone`/`variant` prop: none of the confirmed
 * candidate call sites currently distinguish status by color, so none is
 * introduced here (`docs/archive/UI-UX-2026-11-11.md` — "never rely on color alone to convey
 * meaning"). Deliberately not applied to the SkillTree stage/progression
 * list itself (SPEC BR-11) — that presentation is out of this feature's
 * scope entirely.
 */
export function Badge({ className, children, ...props }: BadgeProps) {
  return (
    <span className={cx(BASE_CLASSNAME, className)} {...props}>
      {children}
    </span>
  );
}
