"use client";

import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import type { AdminSkillTreeEntry } from "../../skill-trees/client/skill-trees-gateway";
import { adminRolesCopy } from "../copy";

/** A row being edited. `treeId` is `""` until a SkillTree is chosen; validation rejects it. */
export interface DraftExpectation {
  treeId: string;
  expectedLevel: number;
}

/** The maximum number of expectations per role (BR-3, PG-10 limits). */
export const MAX_EXPECTATIONS = 20;
const LEVELS = [2, 3, 4] as const;

interface ExpectationsEditorProps {
  idPrefix: string;
  value: DraftExpectation[];
  catalog: AdminSkillTreeEntry[];
  error?: string;
  onChange: (next: DraftExpectation[]) => void;
}

/** Skill-area picker and level select for a role's expectations. Client-side guidance only; the server is authoritative. */
export function ExpectationsEditor({ idPrefix, value, catalog, error, onChange }: ExpectationsEditorProps) {
  const copy = adminRolesCopy.form;

  function updateRow(index: number, change: Partial<DraftExpectation>) {
    onChange(value.map((row, position) => (position === index ? { ...row, ...change } : row)));
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{adminRolesCopy.expectationsLabel}</legend>
      {value.length > 0 && (
        <ul className="flex flex-col gap-3">
          {value.map((row, index) => (
            <li key={index} className="flex flex-wrap items-end gap-2">
              <Select
                id={`${idPrefix}-area-${index}`}
                label={copy.areaLabel}
                value={row.treeId}
                onChange={(event) => updateRow(index, { treeId: event.target.value })}
              >
                <option value="">{copy.chooseArea}</option>
                {catalog.map((tree) => (
                  <option key={tree.treeId} value={tree.treeId}>
                    {tree.name}
                  </option>
                ))}
              </Select>
              <Select
                id={`${idPrefix}-level-${index}`}
                label={copy.levelLabel}
                value={String(row.expectedLevel)}
                onChange={(event) => updateRow(index, { expectedLevel: Number(event.target.value) })}
              >
                {LEVELS.map((level) => (
                  <option key={level} value={String(level)}>
                    {level}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onChange(value.filter((_, position) => position !== index))}
              >
                {copy.removeExpectation}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col items-start gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={value.length >= MAX_EXPECTATIONS}
          onClick={() => onChange([...value, { treeId: "", expectedLevel: 2 }])}
        >
          {copy.addExpectation}
        </Button>
        {value.length >= MAX_EXPECTATIONS && <p className="text-sm text-zinc-600 dark:text-zinc-400">{copy.expectationLimit}</p>}
      </div>
      {error !== undefined && <Alert variant="error">{error}</Alert>}
    </fieldset>
  );
}
