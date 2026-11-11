"use client";

import { useRef, type KeyboardEvent } from "react";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import type { TeamSkillLevel } from "../domain/team-skill";
import { teamSkillsCopy } from "../copy";

const LEVELS: readonly TeamSkillLevel[] = [1, 2, 3, 4];

/**
 * Compact four-option rating control (docs/features/team-owned-skills/SPEC.md; personal UX §7.2). A radio group with roving
 * focus: arrow keys only move focus, and a rating is saved only by a click or by Enter/Space, so focus and hover never
 * write. The selected level is shown by text and a filled state, not by colour alone. Each option's accessible name is
 * the skill name plus the full level name.
 */
export function TeamSkillRatingControl({
  skillName,
  value,
  disabled = false,
  onSelect,
}: {
  skillName: string;
  value: TeamSkillLevel | null;
  disabled?: boolean;
  onSelect: (level: TeamSkillLevel) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusIndex = value === null ? 0 : LEVELS.indexOf(value);

  function move(from: number, step: number) {
    const next = (from + step + LEVELS.length) % LEVELS.length;
    refs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(index, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(index, -1);
    }
  }

  return (
    <div role="radiogroup" aria-label={teamSkillsCopy.own.groupLabel(skillName)} className="flex flex-wrap gap-1.5">
      {LEVELS.map((level, index) => {
        const copy = SELF_ASSESSED_LEVEL_COPY[level];
        const checked = value === level;
        return (
          <button
            key={level}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${skillName}: ${level}. ${copy.name}`}
            tabIndex={index === focusIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onSelect(level)}
            onKeyDown={(event) => onKeyDown(event, index)}
            title={copy.name}
            className={
              "flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60 sm:min-h-9 " +
              (checked
                ? "border-primary bg-primary text-text-inverse"
                : "border-border-strong bg-surface text-text-primary hover:bg-surface-muted")
            }
          >
            <span aria-hidden="true" className="tabular-nums">
              {level}
            </span>
          </button>
        );
      })}
    </div>
  );
}
