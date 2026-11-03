/**
 * Joins conditional class names, dropping falsy values. Used across
 * `src/components/ui/` primitives to combine a base treatment, a variant,
 * and an optional caller-supplied `className` without a class-merge library
 * dependency this repository doesn't otherwise have.
 */
export function cx(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

/**
 * Joins present element ids into one `aria-describedby` value, dropping
 * absent ones — shared by `TextField`/`TextArea`/`Select` so a field with a
 * description, an error, both, or neither always gets the correct
 * association without each primitive re-deriving the same three-line rule.
 */
export function describedByIds(...ids: Array<string | undefined>): string | undefined {
  const present = ids.filter((id): id is string => Boolean(id));
  return present.length > 0 ? present.join(" ") : undefined;
}

/**
 * The single shared visual/focus treatment for a native text-style form
 * control (`TextField`/`TextArea`/`Select`), consolidating the near-identical
 * Tailwind string this codebase previously duplicated across roughly a dozen
 * hand-rolled inputs/textareas/selects (docs/features/ui-refresh/SPEC.md —
 * "Problem", BR-6).
 */
// Focus comes from the global :focus-visible rule (app/globals.css).
export const FORM_CONTROL_CLASSNAME =
  "rounded-field border border-border-strong bg-surface px-3 py-2 text-body-secondary text-text-primary";

// Single-line controls: 44 px on mobile, 40 px from md (SPEC: Form hierarchy).
export const FORM_CONTROL_HEIGHT_CLASSNAME = "h-11 md:h-10";
