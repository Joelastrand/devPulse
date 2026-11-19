import { cx } from "./class-names";

export interface FilterChipOption<T extends string> {
  id: T;
  label: string;
}

export interface FilterChipsProps<T extends string> {
  /** Accessible name of the group, e.g. "Filtrer utfordringer etter status". */
  label: string;
  options: ReadonlyArray<FilterChipOption<T>>;
  value: T;
  onChange: (value: T) => void;
}

/**
 * Compact single-choice filter for a list. Each option is a button with `aria-pressed`, so the selected state is
 * announced and shown by border, background and text weight, not colour alone. It is a filter, not navigation: it never
 * changes the URL, and it sits inside a tab panel rather than adding another row to the tab bar.
 */
export function FilterChips<T extends string>({ label, options, value, onChange }: FilterChipsProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((option) => {
        const pressed = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.id)}
            className={cx(
              "rounded-control border px-3 py-1.5 text-sm font-medium transition-colors duration-micro ease-standard",
              pressed
                ? "border-primary bg-primary-subtle font-semibold text-text-primary"
                : "border-border-subtle text-text-secondary hover:bg-surface-subtle hover:text-text-primary",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
