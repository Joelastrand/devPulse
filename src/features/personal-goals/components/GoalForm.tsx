"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import type { CreateGoalInput, UpdateGoalInput } from "../client/goals-gateway";
import { goalsCopy } from "../copy";
import type { GoalDto, SkillOptionDto } from "../domain/goal";

/** Select values: `""` is `Ingen`; the marker keeps an unavailable stored link as "unchanged" (BR-40). Never a valid tree id. */
const NO_AREA = "";
const KEEP_UNAVAILABLE_AREA = "__unchanged__";

export type GoalFormSubmit =
  | { mode: "create"; input: CreateGoalInput }
  | { mode: "edit"; input: UpdateGoalInput };

interface GoalFormProps {
  /** The goal being edited, or `undefined` to create. */
  goal?: GoalDto;
  skillOptions: SkillOptionDto[];
  /** Resolves to an error message to show (form content is kept), or `undefined` when the save succeeded. */
  onSubmit: (submit: GoalFormSubmit) => Promise<string | undefined>;
  onCancel: () => void;
}

function initialAreaValue(goal: GoalDto | undefined): string {
  if (!goal || goal.treeId === null) return NO_AREA;
  return goal.areaAvailable ? goal.treeId : KEEP_UNAVAILABLE_AREA;
}

/** Only fields that differ from the goal are sent; absent = unchanged, `null` = removed (BR-22). */
function buildChange(goal: GoalDto, title: string, area: string, targetDate: string): UpdateGoalInput {
  const change: UpdateGoalInput = {};
  if (title !== goal.title) change.title = title;
  if (area !== initialAreaValue(goal)) change.treeId = area === NO_AREA ? null : area;
  if (targetDate !== (goal.targetDate ?? "")) change.targetDate = targetDate === "" ? null : targetDate;
  return change;
}

function buildCreate(title: string, area: string, targetDate: string): CreateGoalInput {
  return {
    title,
    ...(area !== NO_AREA ? { treeId: area } : {}),
    ...(targetDate !== "" ? { targetDate } : {}),
  };
}

/** Native create/edit form (BR-48 state 4). Validation of the title itself stays with the server. */
export function GoalForm({ goal, skillOptions, onSubmit, onCancel }: GoalFormProps) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [area, setArea] = useState(initialAreaValue(goal));
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [titleError, setTitleError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  const idPrefix = goal ? `edit-goal-${goal.id}` : "create-goal";
  // The linked tree stays selectable when it is outside the bounded option window (BR-36d).
  const linkedOutsideWindow =
    goal?.areaAvailable === true &&
    goal.treeId !== null &&
    goal.areaName !== null &&
    !skillOptions.some((option) => option.treeId === goal.treeId)
      ? { treeId: goal.treeId, name: goal.areaName }
      : undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFormError(undefined);
    if (title.trim() === "") {
      setTitleError(goalsCopy.titleRequired);
      return;
    }
    setTitleError(undefined);

    if (goal) {
      const change = buildChange(goal, title, area, targetDate);
      if (Object.keys(change).length === 0) {
        onCancel();
        return;
      }
      await submit({ mode: "edit", input: change });
    } else {
      await submit({ mode: "create", input: buildCreate(title, area, targetDate) });
    }
  }

  async function submit(payload: GoalFormSubmit) {
    setPending(true);
    const message = await onSubmit(payload);
    setPending(false);
    if (message !== undefined) setFormError(message);
  }

  const submitLabel = goal
    ? pending ? goalsCopy.editSubmitting : goalsCopy.editSubmit
    : pending ? goalsCopy.createSubmitting : goalsCopy.createSubmit;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <TextField
        id={`${idPrefix}-title`}
        label={goalsCopy.titleLabel}
        required
        value={title}
        error={titleError}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Select
        id={`${idPrefix}-area`}
        label={goalsCopy.areaLabel}
        value={area}
        onChange={(event) => setArea(event.target.value)}
      >
        <option value={NO_AREA}>{goalsCopy.areaNone}</option>
        {goal && initialAreaValue(goal) === KEEP_UNAVAILABLE_AREA && (
          <option value={KEEP_UNAVAILABLE_AREA}>{goalsCopy.areaUnavailable}</option>
        )}
        {linkedOutsideWindow && <option value={linkedOutsideWindow.treeId}>{linkedOutsideWindow.name}</option>}
        {skillOptions.map((option) => (
          <option key={option.treeId} value={option.treeId}>
            {option.name}
          </option>
        ))}
      </Select>
      <TextField
        id={`${idPrefix}-target-date`}
        type="date"
        label={goalsCopy.targetDateLabel}
        value={targetDate}
        onChange={(event) => setTargetDate(event.target.value)}
      />
      {formError && <Alert variant="error">{formError}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" pending={pending}>
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
          {goalsCopy.cancelButton}
        </Button>
      </div>
    </form>
  );
}
