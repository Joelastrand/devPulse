/**
 * Joins conditional class names, dropping falsy values. Used across
 * `src/components/ui/` primitives to combine a base treatment, a variant,
 * and an optional caller-supplied `className` without a class-merge library
 * dependency this repository doesn't otherwise have.
 */
export function cx(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}
