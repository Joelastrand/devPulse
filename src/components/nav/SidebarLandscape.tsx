/**
 * Original landscape band for the bottom of the desktop sidebar: layered
 * hills and a few pine shapes drawn in the brand greens. Decorative only.
 */
export function SidebarLandscape() {
  return (
    <svg
      viewBox="0 0 248 200"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-56 w-full"
    >
      <path d="M0 96 C 56 62, 118 118, 176 88 S 232 74, 248 84 V200 H0 Z" className="fill-brand-900" />
      <path d="M0 132 C 64 102, 124 150, 186 122 S 236 112, 248 120 V200 H0 Z" className="fill-brand-800" />
      <g className="fill-brand-950">
        <path d="M18 200 L34 150 L50 200 Z" />
        <path d="M40 200 L56 158 L72 200 Z" />
        <path d="M196 200 L214 146 L232 200 Z" />
        <path d="M218 200 L232 162 L246 200 Z" />
      </g>
    </svg>
  );
}
