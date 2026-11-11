"use client";

import { LINK_MAX } from "../domain/constants";
import { workspaceCopy } from "../copy";

export interface LinkOption {
  id: string;
  title: string;
}

interface LinkPickerProps {
  /** Unique field name prefix, so several pickers can share one form. */
  idPrefix: string;
  legend: string;
  options: readonly LinkOption[];
  selected: readonly string[];
  emptyText: string;
  onChange: (next: string[]) => void;
  /** Ids that are linked but no longer exist; shown as unavailable and kept selectable only to be removed. */
  missingIds?: readonly string[];
}

/**
 * Checkbox group for choosing the owner's own records as links (BR-22, BR-60). It never offers a record outside the owner's
 * list, and it stops at the link limit (LINK_MAX). A link that no longer resolves is shown with the BR-22 text.
 */
export function LinkPicker({ idPrefix, legend, options, selected, emptyText, onChange, missingIds = [] }: LinkPickerProps) {
  const atLimit = selected.length >= LINK_MAX;
  const toggle = (id: string, checked: boolean) => {
    if (checked) onChange([...selected, id].slice(0, LINK_MAX));
    else onChange(selected.filter((item) => item !== id));
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-text-primary">{legend}</legend>
      {options.length === 0 && missingIds.length === 0 ? <p className="text-sm text-text-secondary">{emptyText}</p> : null}
      <ul className="space-y-1">
        {options.map((option) => {
          const checked = selected.includes(option.id);
          const inputId = `${idPrefix}-${option.id}`;
          return (
            <li key={option.id}>
              <label htmlFor={inputId} className="flex min-h-11 items-center gap-2 text-sm text-text-primary">
                <input
                  id={inputId}
                  type="checkbox"
                  className="h-4 w-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2"
                  checked={checked}
                  disabled={!checked && atLimit}
                  onChange={(event) => toggle(option.id, event.target.checked)}
                />
                <span className="break-words">{option.title}</span>
              </label>
            </li>
          );
        })}
        {missingIds.map((id) => (
          <li key={`missing-${id}`} className="text-sm text-text-secondary">
            {workspaceCopy.missingLink}
          </li>
        ))}
      </ul>
      {atLimit ? <p className="text-xs text-text-secondary">{workspaceCopy.links.limit}</p> : null}
    </fieldset>
  );
}
