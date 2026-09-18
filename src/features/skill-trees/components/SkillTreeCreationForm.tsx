"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { createAdminSkillTree } from "../client/skill-trees-gateway";
import { adminSkillsCopy } from "../copy";
import {
  SKILL_NODE_LABEL_MAX_LENGTH,
  SKILL_NODE_LABEL_MIN_LENGTH,
  SKILL_TREE_NAME_MAX_LENGTH,
  SKILL_TREE_NAME_MIN_LENGTH,
} from "../domain/skill-tree-input";
import { SKILL_TREE_MAX_NODES, SKILL_TREE_MIN_NODES } from "../domain/skill-tree";

type SubmitState = { status: "idle" } | { status: "pending" } | { status: "error"; message: string };

function isClientValid(name: string, labels: string[]): boolean {
  const trimmedName = name.trim();
  if (trimmedName.length < SKILL_TREE_NAME_MIN_LENGTH || trimmedName.length > SKILL_TREE_NAME_MAX_LENGTH) {
    return false;
  }
  if (labels.length < SKILL_TREE_MIN_NODES || labels.length > SKILL_TREE_MAX_NODES) {
    return false;
  }
  return labels.every((label) => {
    const trimmed = label.trim();
    return trimmed.length >= SKILL_NODE_LABEL_MIN_LENGTH && trimmed.length <= SKILL_NODE_LABEL_MAX_LENGTH;
  });
}

/**
 * The TASK-005 SkillTree creation form (docs/features/team-skill-tree/
 * SPEC.md — BR-26): a name field plus a dynamic list of 2-20 ordered
 * stage-label inputs with keyboard-operable add/remove-row controls. Client-
 * side boundary validation is a UX aid only — `createAdminSkillTree` (and,
 * behind it, `createSkillTree`) remains the sole authority; the server
 * assigns every node's `nodeId`/`order`, never this form.
 */
export function SkillTreeCreationForm({
  token,
  onCreated,
}: {
  token: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [labels, setLabels] = useState<string[]>(["", ""]);
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });

  function updateLabel(index: number, value: string) {
    setLabels((prev) => prev.map((label, i) => (i === index ? value : label)));
  }

  function addRow() {
    setLabels((prev) => (prev.length >= SKILL_TREE_MAX_NODES ? prev : [...prev, ""]));
  }

  function removeRow(index: number) {
    setLabels((prev) => (prev.length <= SKILL_TREE_MIN_NODES ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitState.status === "pending") {
      return;
    }

    if (!isClientValid(name, labels)) {
      setSubmitState({ status: "error", message: adminSkillsCopy.creation.error.invalidInput });
      return;
    }

    setSubmitState({ status: "pending" });
    const result = await createAdminSkillTree(token, name, labels);

    if (!result.ok) {
      const message =
        result.error === "invalid_input"
          ? adminSkillsCopy.creation.error.invalidInput
          : adminSkillsCopy.creation.error.generic;
      setSubmitState({ status: "error", message });
      return;
    }

    setSubmitState({ status: "idle" });
    setName("");
    setLabels(["", ""]);
    onCreated();
  }

  return (
    <Card as="section" variant="elevated" padding="lg" aria-labelledby="skill-tree-creation-heading">
      <h2 id="skill-tree-creation-heading" className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
        {adminSkillsCopy.creation.sectionTitle}
      </h2>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="skill-tree-name" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {adminSkillsCopy.creation.nameLabel}
          </label>
          <input
            id="skill-tree-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div className="flex flex-col gap-3">
          {labels.map((label, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-2">
                <label
                  htmlFor={`skill-tree-stage-${index}`}
                  className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
                >
                  {adminSkillsCopy.creation.stageLabelPrefix} {index + 1}
                </label>
                <input
                  id={`skill-tree-stage-${index}`}
                  type="text"
                  value={label}
                  onChange={(event) => updateLabel(index, event.target.value)}
                  className="rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={labels.length <= SKILL_TREE_MIN_NODES}
                onClick={() => removeRow(index)}
                aria-label={`${adminSkillsCopy.creation.removeStageButton} ${index + 1}`}
              >
                {adminSkillsCopy.creation.removeStageButton}
              </Button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="secondary"
          className="self-start"
          disabled={labels.length >= SKILL_TREE_MAX_NODES}
          onClick={addRow}
        >
          {adminSkillsCopy.creation.addStageButton}
        </Button>

        {submitState.status === "error" && <Alert variant="error">{submitState.message}</Alert>}

        <Button type="submit" className="self-start" pending={submitState.status === "pending"}>
          {submitState.status === "pending"
            ? adminSkillsCopy.creation.submittingButton
            : adminSkillsCopy.creation.submitButton}
        </Button>
      </form>
    </Card>
  );
}
