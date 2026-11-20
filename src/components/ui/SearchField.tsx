import { cx, FORM_CONTROL_CLASSNAME, FORM_CONTROL_HEIGHT_CLASSNAME } from "./class-names";
import { Button } from "./Button";

export interface SearchFieldProps {
  id: string;
  /** Accessible name. Always set: a search box without a name is not announced meaningfully. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Label for the clear button; the button is shown only while the field has text. */
  clearLabel: string;
  className?: string;
}

/**
 * Presentational search box for an already-loaded list. The caller owns the query state and the filtering (see
 * `components/ui/search-match.ts`). Escape clears the query, a standard search-box convention. Purely visual otherwise.
 */
export function SearchField({ id, label, value, onChange, placeholder, clearLabel, className }: SearchFieldProps) {
  return (
    <div className={cx("relative w-full sm:max-w-xs", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value !== "") {
            event.preventDefault();
            onChange("");
          }
        }}
        className={cx(FORM_CONTROL_CLASSNAME, FORM_CONTROL_HEIGHT_CLASSNAME, "w-full pr-20")}
      />
      {value !== "" ? (
        <div className="absolute inset-y-0 right-1 flex items-center">
          <Button type="button" size="sm" variant="tertiary" onClick={() => onChange("")}>
            {clearLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
