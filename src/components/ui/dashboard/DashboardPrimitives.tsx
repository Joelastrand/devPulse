import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "../Card";
import { Icon } from "../Icon";
import { cx } from "../class-names";
import { StatusBadge, type StatusTone } from "../StatusBadge";

/**
 * Presentation primitives shared by the visual-redesign page compositions
 * (docs/features/visual-redesign/SPEC.md — AD-3, BR-5, BR-33). Each takes
 * already-resolved values. None fetches data, decides a status or derives a
 * metric: callers pass text, numbers and a tone they already have.
 */

/** Shown in place of a value that is suppressed, missing or not yet available. Never a zero. */
export const INSUFFICIENT_DATA_TEXT = "Ikke nok data til å vise dette ennå.";

export function InsufficientData({ className }: { className?: string }) {
  return <p className={cx("text-help text-text-muted", className)}>{INSUFFICIENT_DATA_TEXT}</p>;
}

export interface StatTileProps {
  label: string;
  /** Pre-formatted value text. Omitted when the value is unavailable. */
  value?: string;
  /** Short text beside the value, such as a delta the caller already holds. */
  detail?: string;
  tone?: StatusTone;
  /** Text status, shown with the tone so colour is never the only signal. */
  statusText?: string;
  icon?: LucideIcon;
  className?: string;
}

/** A single summary figure in a row of tiles. Shows the insufficient-data state when no value is given. */
export function StatTile({ label, value, detail, tone, statusText, icon, className }: StatTileProps) {
  return (
    <Card as="section" variant="bordered" padding="sm" aria-label={label} className={cx("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-label font-medium text-text-secondary">
          {icon ? <Icon icon={icon} size="inline" className="text-primary" /> : null}
          {label}
        </p>
        {statusText ? <StatusBadge tone={tone ?? "neutral"}>{statusText}</StatusBadge> : null}
      </div>
      {value !== undefined ? (
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="text-metric font-semibold tabular-nums text-text-primary">{value}</span>
          {detail ? <span className="text-help text-text-secondary">{detail}</span> : null}
        </p>
      ) : (
        <InsufficientData />
      )}
    </Card>
  );
}

export interface SummaryPanelProps {
  title: string;
  description?: string;
  /** Optional action link or button in the header. Callers pass at most one. */
  action?: ReactNode;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

/** A titled bordered panel. The title is a real heading so the panel is reachable by heading navigation. */
export function SummaryPanel({ title, description, action, icon, children, className }: SummaryPanelProps) {
  return (
    <Card as="section" variant="bordered" padding="md" className={cx("flex flex-col gap-4", className)}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? <Icon icon={icon} size="action" className="mt-0.5 shrink-0 text-primary" /> : null}
          <div className="min-w-0">
            <h2 className="text-card-title font-semibold text-text-primary">{title}</h2>
            {description ? <p className="mt-1 text-help text-text-secondary">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </Card>
  );
}

export interface LevelBarProps {
  label: string;
  /** Pre-formatted value text shown next to the bar. `null` means the value is not available. */
  valueText: string | null;
  /** Position on the bar as a fraction from 0 to 1. Ignored when `valueText` is `null`. */
  fraction: number;
  /** Text status, such as a level label. Shown in text, not colour alone. */
  statusText?: string;
  tone?: StatusTone;
}

/** One labelled level on a scale. The bar is decorative; the value and status are text. */
export function LevelBar({ label, valueText, fraction, statusText, tone }: LevelBarProps) {
  const clamped = Math.min(1, Math.max(0, fraction));
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto]">
      <span className="min-w-0 text-label text-text-primary">{label}</span>
      {valueText === null ? (
        <InsufficientData className="col-span-2 sm:col-span-3" />
      ) : (
        <>
          <span
            aria-hidden="true"
            className="col-span-2 h-2 overflow-hidden rounded-full bg-surface-subtle sm:col-span-1 sm:col-start-2 sm:row-start-1"
          >
            <span className="block h-full rounded-full bg-primary" style={{ width: `${clamped * 100}%` }} />
          </span>
          <span className="text-label font-semibold tabular-nums text-text-primary">{valueText}</span>
          {statusText ? <StatusBadge tone={tone ?? "neutral"}>{statusText}</StatusBadge> : null}
        </>
      )}
    </li>
  );
}

export interface ActionListItemProps {
  href: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
}

/** A row that links to an existing page. The chevron is decorative; the whole row is the link. */
export function ActionListItem({ href, title, description, icon }: ActionListItemProps) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-control px-3 py-3 transition-colors duration-micro ease-standard hover:bg-surface-subtle"
      >
        {icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary-subtle text-primary">
            <Icon icon={icon} size="inline" />
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block text-label font-medium text-text-primary">{title}</span>
          {description ? <span className="block text-help text-text-secondary">{description}</span> : null}
        </span>
        <Icon icon={ChevronRight} size="inline" className="shrink-0 text-text-muted" />
      </Link>
    </li>
  );
}

/** Two-letter initials from a display name. Used instead of photos, which the product does not hold. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase();
}

export interface InitialsAvatarProps {
  name: string;
  className?: string;
}

/** Neutral initials avatar. Decorative: the name is shown as text beside it wherever it appears. */
export function InitialsAvatar({ name, className }: InitialsAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-help font-semibold text-text-secondary",
        className,
      )}
    >
      {initialsFor(name)}
    </span>
  );
}
