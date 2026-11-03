import { uiCopy } from "./copy";

/** The id of the main content region every layout renders. */
export const SKIP_LINK_TARGET_ID = "main-content";

/**
 * Skip-to-content link, the first focusable element on every layout
 * (docs/features/product-experience/SPEC.md — Focus, Application shell). It is
 * visually hidden until it receives focus.
 */
export function SkipLink() {
  return (
    <a
      href={`#${SKIP_LINK_TARGET_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 rounded-control bg-surface px-4 py-2 text-label font-medium text-text-primary shadow-elevated"
    >
      {uiCopy.skipToContent}
    </a>
  );
}
