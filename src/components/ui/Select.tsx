import type { SelectHTMLAttributes } from "react";
import { Alert } from "./Alert";
import { cx, describedByIds, FORM_CONTROL_CLASSNAME } from "./class-names";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  /** Rendered as a real, associated `<label htmlFor={id}>`. */
  label: string;
  /** Optional hint text, associated via `aria-describedby`. */
  description?: string;
  /** A field-specific validation error, rendered via the shared `Alert` (preserving `role="alert"`) and associated via `aria-describedby`; also sets `aria-invalid`. */
  error?: string;
}

/**
 * Shared simple single-select primitive, the `<select>` counterpart to
 * `TextField` (docs/features/ui-refresh/SPEC.md — BR-6, BR-8, BR-9). The
 * caller supplies its own `<option>` children exactly as it already does
 * with a native `<select>` — this component owns no option list, no
 * multi-select behavior, and no validation logic; native props (`value`,
 * `onChange`, `disabled`, etc.) pass straight through.
 */
export function Select({
  id,
  label,
  description,
  error,
  className,
  children,
  ...props
}: SelectProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByIds(descriptionId, errorId)}
        className={cx(FORM_CONTROL_CLASSNAME, className)}
        {...props}
      >
        {children}
      </select>
      {description && (
        <p id={descriptionId} className="text-sm text-zinc-600 dark:text-zinc-400">
          {description}
        </p>
      )}
      {error && (
        <Alert variant="error" id={errorId} className="text-sm">
          {error}
        </Alert>
      )}
    </div>
  );
}
