"use client";

import { useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import type { SkillCatalogEntry, SkillNeedInput, SkillNeedView } from "../client/team-skills-gateway";
import { teamSkillsCopy } from "../copy";
import {
  isRequiredCoverage,
  isRequiredLevel,
  REQUIRED_COVERAGE_MAX,
  REQUIRED_COVERAGE_MIN,
  REQUIRED_LEVELS,
} from "../domain/skill-need";

export const NEED_AREA_FIELD_ID = "skill-need-area";
export const NEED_LEVEL_FIELD_ID = "skill-need-level";
const COVERAGE_FIELD_ID = "skill-need-coverage";

const copy = teamSkillsCopy.manage;

interface SkillNeedEditorProps {
  /** Areas that may still receive a need (the catalog minus areas that already have one). Unused when editing. */
  selectableAreas: SkillCatalogEntry[];
  /** The need being changed, or `null` to add a new one. The area of an existing need is never editable. */
  editing: SkillNeedView | null;
  /** This form's own save is in flight (shows the saving label). */
  pending: boolean;
  /** Any write, including a delete, is in flight: nothing here is actionable, but only `pending` relabels the button. */
  locked: boolean;
  onSubmit: (treeId: string, input: SkillNeedInput) => void;
  onCancelEdit: () => void;
}

/**
 * The single lead-only need form (SPEC BR-26 — add/edit; BR-28). One logical editor state serves both the
 * table and the stacked layout. The two persisted planning fields are the only inputs; the checks here are
 * UX only — the server validates again and decides authorization. Remount with a new `key` to reset it.
 */
export function SkillNeedEditor({ selectableAreas, editing, pending, locked, onSubmit, onCancelEdit }: SkillNeedEditorProps) {
  const [treeId, setTreeId] = useState("");
  const [level, setLevel] = useState<string>(String(editing?.requiredLevel ?? REQUIRED_LEVELS[0]));
  const [coverage, setCoverage] = useState(String(editing?.requiredCoverage ?? REQUIRED_COVERAGE_MIN));
  const [errors, setErrors] = useState<{ area?: string; coverage?: string }>({});

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const targetTreeId = editing?.treeId ?? treeId;
    const requiredLevel = Number(level);
    const requiredCoverage = /^\d+$/.test(coverage.trim()) ? Number(coverage.trim()) : Number.NaN;
    const next: { area?: string; coverage?: string } = {};
    if (targetTreeId === "") next.area = copy.areaRequired;
    if (!isRequiredCoverage(requiredCoverage)) next.coverage = copy.coverageInvalid;
    setErrors(next);
    if (next.area || next.coverage || !isRequiredLevel(requiredLevel)) return;
    onSubmit(targetTreeId, { requiredLevel, requiredCoverage });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <h4 className="text-base font-medium text-zinc-900 dark:text-zinc-50">
        {editing ? copy.editHeading(editing.areaName ?? "") : copy.addHeading}
      </h4>
      {!editing && (
        <Select
          id={NEED_AREA_FIELD_ID}
          label={copy.areaLabel}
          value={treeId}
          error={errors.area}
          disabled={locked}
          onChange={(event) => setTreeId(event.target.value)}
        >
          <option value="">{copy.areaPlaceholder}</option>
          {selectableAreas.map((area) => (
            <option key={area.treeId} value={area.treeId}>
              {area.name}
            </option>
          ))}
        </Select>
      )}
      <Select
        id={NEED_LEVEL_FIELD_ID}
        label={copy.levelLabel}
        value={level}
        disabled={locked}
        onChange={(event) => setLevel(event.target.value)}
      >
        {REQUIRED_LEVELS.map((value) => (
          <option key={value} value={value}>
            {SELF_ASSESSED_LEVEL_COPY[value].name}
          </option>
        ))}
      </Select>
      <TextField
        id={COVERAGE_FIELD_ID}
        type="number"
        inputMode="numeric"
        min={REQUIRED_COVERAGE_MIN}
        max={REQUIRED_COVERAGE_MAX}
        step={1}
        label={copy.coverageLabel}
        description={`${copy.coverageHint} ${copy.targetHint}`}
        value={coverage}
        error={errors.coverage}
        disabled={locked}
        onChange={(event) => setCoverage(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" pending={pending} disabled={locked}>
          {pending ? copy.saving : editing ? copy.saveButton : copy.addButton}
        </Button>
        {editing && (
          <Button type="button" variant="secondary" size="sm" disabled={locked} onClick={onCancelEdit}>
            {copy.cancelEdit}
          </Button>
        )}
      </div>
    </form>
  );
}
