"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import { SELF_ASSESSED_LEVELS, isSelfAssessedLevel, type SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { isRoadmapPriority, ROADMAP_PRIORITIES, type RoadmapPriority } from "../../roadmap/domain/roadmap-item";
import { isValidPlanDate } from "../../roadmap/domain/roadmap-dates";
import {
  MILESTONE_TITLE_MAX_LENGTH,
  PLAN_MILESTONES_MAX,
  PLAN_TITLE_MAX_LENGTH,
  normalizePlanTitle,
  type MilestoneStatus,
} from "../domain/competence-plan";
import { MILESTONE_STATUS_LABEL, PRIORITY_LABEL, competencePlanCopy } from "../copy";
import type { ClientCompetencePlan, CompetencePlanInput, CompetencePlanWriteResult } from "../client/competence-plan-gateway";

const MILESTONE_STATUSES: readonly MilestoneStatus[] = ["planned", "in_progress", "completed"];

interface MilestoneRow {
  /** Stable React key: the milestone id for stored rows, a generated key for new rows. */
  key: string;
  id?: string;
  title: string;
  targetDate: string;
  status: MilestoneStatus;
}

export interface CompetencePlanEditorProps {
  /** Stable form-id prefix, unique per editor on the page. */
  idPrefix: string;
  /** `null` creates a new plan. */
  initial: ClientCompetencePlan | null;
  onSave: (input: CompetencePlanInput) => Promise<CompetencePlanWriteResult>;
  onCancel: () => void;
  onSaved: () => void;
}

/**
 * Lead editor for one plan (TASK-006, BR-15). Sends the whole editable plan; the server validates and is the only
 * authorization boundary. Client checks only avoid obvious mistakes.
 */
export function CompetencePlanEditor({ idPrefix, initial, onSave, onCancel, onSaved }: CompetencePlanEditorProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [targetStage, setTargetStage] = useState<SelfAssessedLevel>(initial?.targetStage ?? 2);
  const [priority, setPriority] = useState<RoadmapPriority>(initial?.priority ?? "medium");
  const [archived, setArchived] = useState(initial?.archived ?? false);
  const [rows, setRows] = useState<MilestoneRow[]>(() =>
    (initial?.milestones ?? []).map((m) => ({
      key: m.id,
      id: m.id,
      title: m.title,
      targetDate: m.targetDate ?? "",
      status: m.status,
    })),
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ variant: "error" | "success"; text: string } | null>(null);
  const [titleError, setTitleError] = useState(false);
  const [planTitleError, setPlanTitleError] = useState(false);

  function updateRow(key: string, patch: Partial<MilestoneRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    const key = `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    setRows((current) => [...current, { key, title: "", targetDate: "", status: "planned" }]);
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const planTitle = normalizePlanTitle(title);
    setPlanTitleError(planTitle === null);
    if (planTitle === null) {
      setMessage({ variant: "error", text: competencePlanCopy.invalidInput });
      return;
    }
    const emptyTitle = rows.some((row) => row.title.trim().length === 0);
    setTitleError(emptyTitle);
    if (emptyTitle) {
      setMessage({ variant: "error", text: competencePlanCopy.invalidInput });
      return;
    }
    const dateInvalid = rows.some((row) => row.targetDate !== "" && !isValidPlanDate(row.targetDate));
    if (dateInvalid) {
      setMessage({ variant: "error", text: competencePlanCopy.invalidInput });
      return;
    }
    setPending(true);
    setMessage(null);
    const result = await onSave({
      title: planTitle,
      targetStage,
      priority,
      archived,
      milestones: rows.map((row) => ({
        ...(row.id !== undefined ? { id: row.id } : {}),
        title: row.title.trim(),
        targetDate: row.targetDate === "" ? null : row.targetDate,
        status: row.status,
      })),
    });
    setPending(false);
    if (result.status === "ok") {
      setMessage({ variant: "success", text: competencePlanCopy.saved });
      onSaved();
      return;
    }
    const text =
      result.status === "invalid_input"
        ? competencePlanCopy.invalidInput
        : result.status === "conflict"
          ? competencePlanCopy.saveConflict
          : result.status === "forbidden" || result.status === "unauthenticated"
            ? competencePlanCopy.saveForbidden
            : competencePlanCopy.saveFailed;
    setMessage({ variant: "error", text });
  }

  return (
    <form
      aria-label={initial ? `${competencePlanCopy.edit}: ${initial.title}` : competencePlanCopy.newPlanHeading}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
      noValidate
    >
      {message ? <Alert variant={message.variant} role={message.variant === "error" ? "alert" : "status"}>{message.text}</Alert> : null}
      <TextField
        id={`${idPrefix}-title`}
        label={competencePlanCopy.titleField}
        value={title}
        maxLength={PLAN_TITLE_MAX_LENGTH}
        aria-invalid={planTitleError}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          id={`${idPrefix}-target-stage`}
          label={competencePlanCopy.targetStageField}
          value={String(targetStage)}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (isSelfAssessedLevel(value)) setTargetStage(value);
          }}
        >
          {SELF_ASSESSED_LEVELS.map((level) => (
            <option key={level} value={level}>
              {SELF_ASSESSED_LEVEL_COPY[level].name}
            </option>
          ))}
        </Select>
        <Select
          id={`${idPrefix}-priority`}
          label={competencePlanCopy.priorityField}
          value={priority}
          onChange={(event) => {
            const value = event.target.value;
            if (isRoadmapPriority(value)) setPriority(value);
          }}
        >
          {ROADMAP_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {PRIORITY_LABEL[value]}
            </option>
          ))}
        </Select>
        <label className="flex items-end gap-2 pb-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
            className="h-4 w-4"
          />
          {competencePlanCopy.archiveField}
        </label>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-text-primary">{competencePlanCopy.milestonesHeading}</legend>
        {rows.length === 0 ? <p className="text-sm text-text-secondary">{competencePlanCopy.milestonesEmpty}</p> : null}
        {rows.map((row, index) => (
          <div key={row.key} className="grid gap-3 rounded-field border border-border-subtle p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <TextField
              id={`${idPrefix}-milestone-${row.key}-title`}
              label={`${competencePlanCopy.milestoneTitle} ${index + 1}`}
              value={row.title}
              maxLength={MILESTONE_TITLE_MAX_LENGTH}
              aria-invalid={titleError && row.title.trim().length === 0}
              onChange={(event) => updateRow(row.key, { title: event.target.value })}
            />
            <TextField
              id={`${idPrefix}-milestone-${row.key}-date`}
              label={`${competencePlanCopy.milestoneTargetDate} ${index + 1}`}
              type="date"
              value={row.targetDate}
              onChange={(event) => updateRow(row.key, { targetDate: event.target.value })}
            />
            <Select
              id={`${idPrefix}-milestone-${row.key}-status`}
              label={`${competencePlanCopy.milestoneStatus} ${index + 1}`}
              value={row.status}
              onChange={(event) => {
                const value = event.target.value;
                if (MILESTONE_STATUSES.includes(value as MilestoneStatus)) updateRow(row.key, { status: value as MilestoneStatus });
              }}
            >
              {MILESTONE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {MILESTONE_STATUS_LABEL[value]}
                </option>
              ))}
            </Select>
            <Button variant="tertiary" size="sm" onClick={() => removeRow(row.key)}>
              {competencePlanCopy.milestoneRemove} {index + 1}
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={addRow}
            disabled={rows.length >= PLAN_MILESTONES_MAX}
          >
            {competencePlanCopy.milestoneAdd}
          </Button>
        </div>
      </fieldset>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="tertiary" onClick={onCancel} disabled={pending}>
          {competencePlanCopy.cancel}
        </Button>
        <Button type="submit" pending={pending}>
          {pending ? competencePlanCopy.saving : competencePlanCopy.save}
        </Button>
      </div>
    </form>
  );
}
