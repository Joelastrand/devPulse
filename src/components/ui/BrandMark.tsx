import { cx } from "./class-names";

interface BrandMarkProps {
  className?: string;
}

/**
 * DevPulse mark: a rounded green tile with three rising bars. The mark is
 * decorative because the wordmark next to it carries the name.
 */
export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cx("size-8 shrink-0", className)}
    >
      <rect width="32" height="32" rx="9" className="fill-brand-600" />
      <rect x="7" y="18" width="4" height="7" rx="1" className="fill-brand-100" />
      <rect x="14" y="13" width="4" height="12" rx="1" className="fill-brand-100" />
      <rect x="21" y="8" width="4" height="17" rx="1" className="fill-brand-100" />
    </svg>
  );
}
