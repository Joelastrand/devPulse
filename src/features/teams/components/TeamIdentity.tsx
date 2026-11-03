/**
 * Original landscape identity for a team card. The variant is derived from
 * the team id, so a team keeps the same picture without any stored image
 * or user-supplied content. Decorative only.
 */
const VARIANTS = [
  { sky: "fill-brand-100", far: "fill-brand-200", near: "fill-brand-600", trees: "fill-brand-900" },
  { sky: "fill-primary-subtle", far: "fill-brand-200", near: "fill-brand-700", trees: "fill-brand-950" },
  { sky: "fill-chart-2/15", far: "fill-chart-2/35", near: "fill-chart-2", trees: "fill-brand-950" },
] as const;

function variantIndex(teamId: string): number {
  let hash = 0;
  for (const char of teamId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % VARIANTS.length;
}

export function TeamIdentity({ teamId }: { teamId: string }) {
  const palette = VARIANTS[variantIndex(teamId)];

  return (
    <svg
      viewBox="0 0 240 110"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className="h-28 w-full"
    >
      <rect width="240" height="110" className={palette.sky} />
      <circle cx="182" cy="34" r="14" className="fill-chart-3/40" />
      <path d="M0 70 C 40 40, 90 78, 140 56 S 210 44, 240 58 V110 H0 Z" className={palette.far} />
      <path d="M0 88 C 60 66, 120 96, 180 80 S 230 74, 240 80 V110 H0 Z" className={palette.near} />
      <g className={palette.trees}>
        <path d="M22 110 L38 74 L54 110 Z" />
        <path d="M46 110 L60 84 L74 110 Z" />
        <path d="M196 110 L212 72 L228 110 Z" />
      </g>
    </svg>
  );
}
