import "server-only";
import { applyGoalChange, isValidTreeIdShape, parseStoredGoal, toGoalDto } from "../domain/goal";
import type { Goal, GoalChange, GoalDto, GoalStatus } from "../domain/goal";
import { isAddressableGoalId } from "../domain/goal-constants";
import { isValidGoalTargetDate } from "../domain/goal-target-date";
import { normalizeGoalTitle } from "../domain/goal-title";
import { getDefaultGoalStore } from "./goal-store";
import type { GoalStore } from "./goal-store-types";
import { getDefaultSkillCatalogReader, readSkillTreeName } from "./skill-catalog";
import type { SkillCatalogReader } from "./skill-catalog";

/**
 * Route-shaped PATCH intent (BR-22, validated for key set and primitive types by the route boundary).
 * `undefined` leaves a field unchanged; `null` removes `treeId` / `targetDate`. `title` stays `unknown`
 * so the domain contract decides validity.
 */
export interface UpdatePersonalGoalInput {
  title?: unknown;
  treeId?: string | null;
  targetDate?: string | null;
  status?: GoalStatus;
}

export type UpdatePersonalGoalError =
  | "goal_not_found"
  | "invalid_title"
  | "invalid_target_date"
  | "skill_not_found"
  | "clock_regressed"
  | "persistence_failed";

export type UpdatePersonalGoalResult = { ok: true; dto: GoalDto } | { ok: false; error: UpdatePersonalGoalError };

export interface UpdatePersonalGoalDeps {
  store: GoalStore;
  catalog: SkillCatalogReader;
  now: () => Date;
}

type TransactionOutcome =
  | { kind: "failed"; error: UpdatePersonalGoalError }
  | { kind: "done"; goal: Goal; resolvedTreeName: string | null | undefined };

/**
 * Owner-only edit / complete / reopen (BR-16…BR-18, BR-29, BR-38, BR-40, BR-64). `ownerUid` is the verified
 * subject from the route boundary. Missing, foreign, shape-invalid and malformed goals are one
 * indistinguishable `goal_not_found`; a malformed goal is never repaired or written.
 *
 * The read-validate-write runs in one single-document transaction. The `treeId` existence check happens only
 * when `treeId` changes to a different non-null value, as a direct document-id read (never the selector window)
 * inside the callback after the goal is read; it is not part of the transaction, so a retried callback simply
 * repeats an idempotent read. The clock is read inside the callback.
 */
export async function updatePersonalGoal(
  ownerUid: string,
  goalId: string,
  input: UpdatePersonalGoalInput,
  deps: UpdatePersonalGoalDeps = {
    store: getDefaultGoalStore(),
    catalog: getDefaultSkillCatalogReader(),
    now: () => new Date(),
  },
): Promise<UpdatePersonalGoalResult> {
  if (!isAddressableGoalId(goalId)) return { ok: false, error: "goal_not_found" };

  const change: GoalChange = {};
  if (input.title !== undefined) {
    const title = normalizeGoalTitle(input.title);
    if (!title.ok) return { ok: false, error: "invalid_title" };
    change.title = title.title;
  }
  if (typeof input.targetDate === "string" && !isValidGoalTargetDate(input.targetDate)) {
    return { ok: false, error: "invalid_target_date" };
  }
  if (input.targetDate !== undefined) change.targetDate = input.targetDate;
  if (input.treeId !== undefined) change.treeId = input.treeId;
  if (input.status !== undefined) change.status = input.status;

  try {
    const outcome = await deps.store.runTransaction<TransactionOutcome>(ownerUid, goalId, async (tx) => {
      const raw = await tx.read();
      const stored = raw === undefined ? ({ ok: false } as const) : parseStoredGoal(raw);
      if (!stored.ok) return { kind: "failed", error: "goal_not_found" };

      let resolvedTreeName: string | null | undefined;
      if (typeof input.treeId === "string" && input.treeId !== stored.goal.treeId) {
        if (!isValidTreeIdShape(input.treeId)) return { kind: "failed", error: "skill_not_found" };
        const tree = await readSkillTreeName(input.treeId, deps.catalog);
        if (!tree.ok) return { kind: "failed", error: "persistence_failed" };
        if (tree.name === null) return { kind: "failed", error: "skill_not_found" };
        resolvedTreeName = tree.name;
      }

      const result = applyGoalChange(stored.goal, change, deps.now());
      if ("rejected" in result) return { kind: "failed", error: "clock_regressed" };
      if (result.changed) tx.write(result.goal);
      return { kind: "done", goal: result.goal, resolvedTreeName };
    });
    if (outcome.kind === "failed") return { ok: false, error: outcome.error };

    // BR-39: the response reports current availability; an unchanged tree may have become unavailable (BR-40).
    let areaName = outcome.resolvedTreeName;
    if (areaName === undefined && outcome.goal.treeId !== undefined) {
      const tree = await readSkillTreeName(outcome.goal.treeId, deps.catalog);
      if (!tree.ok) return { ok: false, error: "persistence_failed" };
      areaName = tree.name;
    }
    return { ok: true, dto: toGoalDto(goalId, outcome.goal, areaName ?? null) };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
