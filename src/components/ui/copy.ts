/**
 * Norwegian defaults for `src/components/ui/` primitives that need sensible
 * fallback text (per docs/features/product-ux-shell/SPEC.md — BR-2's copy-
 * module convention). Primitives otherwise take all user-facing text via
 * props/children — this module exists only for the rare default a
 * primitive itself is allowed to own, not for feature/screen copy.
 */
export const uiCopy = {
  loadingDefault: "Laster…",
} as const;
