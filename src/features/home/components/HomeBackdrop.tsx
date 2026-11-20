/**
 * Decorative green wave in the upper-right of the Home content (Home V2 reference). It sits behind the
 * content, takes no pointer events, is hidden from assistive technology and is omitted below `md`, where
 * it would compete with the heading. It uses the semantic `primary-subtle` token, so dark mode follows the theme.
 */
export function HomeBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 hidden h-72 overflow-hidden md:block">
      <svg viewBox="0 0 1200 300" preserveAspectRatio="xMaxYMin slice" focusable="false" className="h-full w-full text-primary-subtle">
        <path d="M430 0 H1200 V170 C1080 120 990 210 870 170 S650 70 530 115 C480 132 448 70 430 0 Z" fill="currentColor" opacity="0.6" />
        <path d="M720 0 H1200 V84 C1100 52 1012 102 922 82 S790 26 720 0 Z" fill="currentColor" opacity="0.4" />
      </svg>
    </div>
  );
}

/** Lower-right wave for the team update card. It is a background shape only, not a measurement. */
export function TeamUpdateWave() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 320 120"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-24 w-full text-primary-subtle"
    >
      <path d="M0 84 C 80 44, 150 112, 232 72 S 300 34, 320 52 V120 H0 Z" fill="currentColor" opacity="0.8" />
    </svg>
  );
}
