import type { TextareaHTMLAttributes } from "react";
import { Alert } from "./Alert";
import { cx, describedByIds, FORM_CONTROL_CLASSNAME } from "./class-names";
import { FieldLabel } from "./FieldLabel";

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  /** Rendered as a real, associated `<label htmlFor={id}>`. */
  label: string;
  /** Marks the field optional with visible text. */
  optional?: boolean;
  /** Optional hint text, associated via `aria-describedby`. */
  description?: string;
  /** A field-specific validation error, rendered via the shared `Alert` (preserving `role="alert"`) and associated via `aria-describedby`; also sets `aria-invalid`. */
  error?: string;
}

/**
 * Shared multi-line text primitive, the `<textarea>` counterpart to
 * `TextField` (docs/archive/features/ui-refresh/SPEC.md — BR-6, BR-8, BR-9). Same
 * label/description/error contract; native props (`value`, `onChange`,
 * `rows`, `placeholder`, `required`, etc.) pass straight through, and no
 * validation logic lives here.
 */
export function TextArea({
  id,
  label,
  optional,
  description,
  error,
  className,
  ...props
}: TextAreaProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={id} label={label} optional={optional} />
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByIds(descriptionId, errorId)}
        className={cx(FORM_CONTROL_CLASSNAME, className)}
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
