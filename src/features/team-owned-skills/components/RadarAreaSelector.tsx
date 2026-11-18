"use client";

import { RADAR_MAX_AXES } from "../domain/radar-model";
import { teamCompetenceCopy } from "../workspace-copy";
import { buttonClassName } from "../../../components/ui/Button";

const copy = teamCompetenceCopy.areaSelector;

export interface RadarAreaOption {
  readonly skillId: string;
  readonly name: string;
}

/**
 * Chooses which eligible areas the radar draws, up to the radar's maximum. The selector is a native disclosure, so it
 * starts collapsed and the radar stays visible; the summary states how many areas are drawn. Each option is a labelled
 * checkbox, so the choice is not conveyed by colour. Unchecked options are disabled once the radar is full.
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
    <details className="group rounded-md border border-border">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        <span className="font-semibold text-text-primary">{copy.summaryAction}</span>
        <span className="text-text-secondary">{copy.summaryCount(selected.length, options.length)}</span>
      </summary>
      <fieldset className="flex flex-col gap-2 border-t border-border-subtle px-3 py-3">
        <legend className="text-sm font-semibold text-text-primary">{copy.legend}</legend>
        <p className="text-sm text-text-secondary">{copy.help(RADAR_MAX_AXES)}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const checked = selected.includes(option.skillId);
            return (
              <label key={option.skillId} className="flex items-start gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={checked}
                  disabled={!checked && full}
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
    </details>
  );
}
