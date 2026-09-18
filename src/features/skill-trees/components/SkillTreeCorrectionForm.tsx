"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { correctAdminSkillTree, type AdminSkillTreeEntry } from "../client/skill-trees-gateway";
import { adminSkillsCopy } from "../copy";
import {
  SKILL_NODE_LABEL_MAX_LENGTH,
  SKILL_NODE_LABEL_MIN_LENGTH,
  SKILL_TREE_NAME_MAX_LENGTH,
  SKILL_TREE_NAME_MIN_LENGTH,
} from "../domain/skill-tree-input";

type SubmitState = { status: "idle" } | { status: "pending" } | { status: "error"; message: string };

function isClientValid(name: string, labels: string[]): boolean {
  const trimmedName = name.trim();
  if (trimmedName.length < SKILL_TREE_NAME_MIN_LENGTH || trimmedName.length > SKILL_TREE_NAME_MAX_LENGTH) {
    return false;
  }
  return labels.every((label) => {
    const trimmed = label.trim();
    return trimmed.length >= SKILL_NODE_LABEL_MIN_LENGTH && trimmed.length <= SKILL_NODE_LABEL_MAX_LENGTH;
  });
}

function errorMessage(error: string): string {
  if (error === "invalid_input") return adminSkillsCopy.correction.error.invalidInput;
  if (error === "tree_not_found") return adminSkillsCopy.correction.error.treeNotFound;
  if (error === "node_count_mismatch") return adminSkillsCopy.correction.error.nodeCountMismatch;
  return adminSkillsCopy.correction.error.generic;
}

/**
 * The TASK-005 SkillTree cosmetic-correction form (docs/features/
 * team-skill-tree/SPEC.md — "Cosmetic tree correction", BR-31, BR-32, BR-34):
 * pre-filled with the target tree's current `name`/labels, with **no
 * add/remove-row control anywhere in its rendered output** — the row count
 * is fixed to `tree.nodes.length` for the component's entire lifetime, so
 * submitting a different node count is structurally unreachable from this
 * UI, not merely disallowed by a rule. `correctAdminSkillTree` (and, behind
 * it, `updateSkillTree`) remains the sole authority on every other
 * structural guarantee (`nodeId`/`order` preservation).
 */
export function SkillTreeCorrectionForm({
  tree,
  token,
  onSuccess,
  onCancel,
}: {
  tree: AdminSkillTreeEntry;
  token: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(tree.name);
  const [labels, setLabels] = useState<string[]>(tree.nodes.map((node) => node.label));
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });

  function updateLabel(index: number, value: string) {
    setLabels((prev) => prev.map((label, i) => (i === index ? value : label)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitState.status === "pending") {
      return;
    }

    if (!isClientValid(name, labels)) {
      setSubmitState({ status: "error", message: adminSkillsCopy.correction.error.invalidInput });
      return;
    }

    setSubmitState({ status: "pending" });
    const result = await correctAdminSkillTree(token, tree.treeId, name, labels);

    if (!result.ok) {
      setSubmitState({ status: "error", message: errorMessage(result.error) });
      return;
    }

    setSubmitState({ status: "idle" });
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-4" aria-label={`Rett opp ${tree.name}`}>
      <div className="flex flex-col gap-2">
        <label
          htmlFor={`skill-tree-correction-name-${tree.treeId}`}
          className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
        >
          {adminSkillsCopy.correction.nameLabel}
        </label>
        <input
          id={`skill-tree-correction-name-${tree.treeId}`}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="flex flex-col gap-3">
        {labels.map((label, index) => (
          <div key={tree.nodes[index]?.nodeId ?? index} className="flex flex-col gap-2">
            <label
              htmlFor={`skill-tree-correction-stage-${tree.treeId}-${index}`}
              className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
            >
              {adminSkillsCopy.correction.stageLabelPrefix} {index + 1}
            </label>
            <input
              id={`skill-tree-correction-stage-${tree.treeId}-${index}`}
              type="text"
              value={label}
              onChange={(event) => updateLabel(index, event.target.value)}
              className="rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        ))}
      </div>

      {submitState.status === "error" && <Alert variant="error">{submitState.message}</Alert>}

      <div className="flex gap-2">
        <Button type="submit" size="sm" pending={submitState.status === "pending"}>
          {submitState.status === "pending"
            ? adminSkillsCopy.correction.submittingButton
            : adminSkillsCopy.correction.submitButton}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {adminSkillsCopy.correction.cancelButton}
        </Button>
      </div>
    </form>
  );
}
