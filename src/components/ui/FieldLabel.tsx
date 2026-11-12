export interface FieldLabelProps {
  htmlFor: string;
  label: string;
  /** Marks an optional field with the text "(valgfritt)", never an asterisk alone. */
  optional?: boolean;
}

/**
 * Label for the form primitives (docs/archive/features/product-experience/SPEC.md —
 * Form hierarchy). The optional marker is text, and it is part of the
 * accessible name, so the field is announced as optional too.
 */
export function FieldLabel({ htmlFor, label, optional = false }: FieldLabelProps) {
  return (
    <label htmlFor={htmlFor} className="text-label font-medium text-text-primary">
      {label}
      {optional ? (
        <>
          {" "}
          <span className="font-normal text-text-muted">(valgfritt)</span>
        </>
      ) : null}
    </label>
  );
}
