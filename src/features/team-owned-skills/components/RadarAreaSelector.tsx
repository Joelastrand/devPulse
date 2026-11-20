"use client";

import { RADAR_MAX_AXES } from "../domain/radar-model";
import { teamCompetenceCopy } from "../workspace-copy";
import { buttonClassName } from "../../../components/ui/Button";
import { CollapsibleSection } from "../../../components/ui/CollapsibleSection";
import { cx } from "../../../components/ui/class-names";

const copy = teamCompetenceCopy.areaSelector;

export interface RadarAreaOption {
  readonly skillId: string;
  readonly name: string;
}

/**
 * Chooses which eligible areas the radar and the level bar chart draw, up to the radar's maximum. It uses the shared
 * collapsible section: collapsed, its summary states how many areas are selected, so the choice is visible without
 * opening it. Each option is a labelled checkbox shown as a chip, so the selected state is text and a check mark, not
 * colour alone. Unchecked options are disabled once the limit is reached.
 */
export function RadarAreaSelector({
  options,
  selected,
  onToggle,
  onReset,
}: {
  readonly options: readonly RadarAreaOption[];
  readonly selected: readonly string[];
  readonly onToggle: (skillId: string) => void;
  readonly onReset: () => void;
}) {
  const full = selected.length >= RADAR_MAX_AXES;
  return (
    <CollapsibleSection
      id="teamkompetanse-area-selector"
      headingLevel={3}
      title={copy.summaryAction}
      description={copy.help(RADAR_MAX_AXES)}
      summary={copy.summaryCount(selected.length, options.length)}
      defaultOpen={false}
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">{copy.legend}</legend>
        <p className="text-sm font-medium text-text-primary">{copy.summaryCount(selected.length, options.length)}</p>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const checked = selected.includes(option.skillId);
            const disabled = !checked && full;
            return (
              <label
                key={option.skillId}
                className={cx(
                  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-sm",
                  checked ? "border-primary bg-surface-subtle font-medium text-text-primary" : "border-border-subtle text-text-secondary",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(option.skillId)}
                />
                <span>{option.name}</span>
              </label>
            );
          })}
        </div>
        {full ? <p className="text-sm text-text-secondary">{copy.limitReached}</p> : null}
        <div>
          <button type="button" onClick={onReset} className={buttonClassName({ variant: "secondary", size: "sm" })}>
            {copy.reset}
          </button>
        </div>
      </fieldset>
    </CollapsibleSection>
  );
}
