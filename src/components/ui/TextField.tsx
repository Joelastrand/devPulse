import type { InputHTMLAttributes } from "react";
import { Alert } from "./Alert";
import { cx, describedByIds, FORM_CONTROL_CLASSNAME, FORM_CONTROL_HEIGHT_CLASSNAME } from "./class-names";
import { FieldLabel } from "./FieldLabel";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  /** Rendered as a real, associated `<label htmlFor={id}>` — never optional, unlike the native `aria-label` fallback other elements accept. */
  label: string;
  /** Marks the field optional with visible text. */
  optional?: boolean;
  /** Optional hint text, associated via `aria-describedby` (e.g. a boundary/format hint). */
  description?: string;
  /** A field-specific validation error. When present, sets `aria-invalid` and renders the message via the shared `Alert` (preserving its existing `role="alert"` semantics), associated via `aria-describedby`. */
  error?: string;
}

/**
 * Shared single-line text-input primitive consolidating this codebase's
 * previously-duplicated input styling (docs/features/ui-refresh/SPEC.md —
 * BR-6, BR-8, BR-9). Purely presentational: every native prop (`value`,
 * `onChange`, `type`, `name`, `autoComplete`, `required`, `placeholder`,
 * `disabled`, etc.) passes straight through unchanged, and this component
 * contains no validation logic of its own — a caller's existing validation
 * timing/rules/error copy are unaffected by adopting it.
 *
 * Always renders a real, visible `<label>` associated via `htmlFor`. When
 * `description` and/or `error` are supplied, both are associated to the
 * input via `aria-describedby` (space-joined, via `describedByIds`) so a
 * screen-reader user always hears the input's rules and its actual error at
 * once, exactly `ChallengeSubmissionPanel.tsx`'s already-correct pattern
 * this primitive generalizes. `error` renders through `Alert`, never a bare
 * `<p>`, so its `role="alert"` semantics are never lost by adopting this
 * primitive in place of a hand-rolled error paragraph.
 */
export function TextField({
  id,
  label,
  optional,
  description,
  error,
  className,
  ...props
}: TextFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={id} label={label} optional={optional} />
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByIds(descriptionId, errorId)}
        className={cx(FORM_CONTROL_CLASSNAME, FORM_CONTROL_HEIGHT_CLASSNAME, className)}
        {...props}
      />
      {description && (
        <p id={descriptionId} className="text-help text-text-muted">
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
