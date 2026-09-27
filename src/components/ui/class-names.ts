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
export const FORM_CONTROL_CLASSNAME =
  "rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
