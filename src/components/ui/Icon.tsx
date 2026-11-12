import type { LucideIcon } from "lucide-react";

/**
 * The single icon wrapper for DevPulse (docs/archive/features/product-experience/SPEC.md
 * — Iconography). `lucide-react` is the only icon family. Callers import
 * their icon from `lucide-react` and pass the component here, so the sizes and
 * stroke width are set in one place.
 */
export const ICON_SIZES = {
  // Beside text-sm.
  inline: 16,
  // Navigation and buttons.
  action: 20,
  // Empty-state and feature icons.
  feature: 24,
} as const;

export type IconSize = keyof typeof ICON_SIZES;

export const ICON_STROKE_WIDTH = 1.75;

export type IconProps = {
  icon: LucideIcon;
  size?: IconSize;
  // Only for icons that carry meaning with no adjacent text. Without a label
  // the icon is decorative and hidden from assistive technology.
  label?: string;
  className?: string;
};

export function Icon({ icon: IconComponent, size = "action", label, className }: IconProps) {
  const decorative = label === undefined;
  return (
    <IconComponent
      size={ICON_SIZES[size]}
      strokeWidth={ICON_STROKE_WIDTH}
      className={className}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : "img"}
      aria-label={label}
      focusable="false"
    />
  );
}
