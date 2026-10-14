import "server-only";
import { createGoal, isValidTreeIdShape, toGoalDto } from "../domain/goal";
import type { GoalDto } from "../domain/goal";
import { GOAL_LIMIT } from "../domain/goal-constants";
import { isValidGoalTargetDate } from "../domain/goal-target-date";
import { normalizeGoalTitle } from "../domain/goal-title";
import { getDefaultGoalStore } from "./goal-store";
import type { GoalStore } from "./goal-store-types";
import { getDefaultSkillCatalogReader, readSkillTreeName } from "./skill-catalog";
import type { SkillCatalogReader } from "./skill-catalog";

/** Shape-checked by the route boundary (BR-22); `title` stays `unknown` so the domain contract decides validity. */
export interface CreatePersonalGoalInput {
  title: unknown;
  treeId?: string;
  targetDate?: string;
}

export type CreatePersonalGoalResult =
  | { ok: true; dto: GoalDto }
  | { ok: false; error: "invalid_title" | "invalid_target_date" | "skill_not_found" | "goal_limit" | "persistence_failed" };

export interface CreatePersonalGoalDeps {
  store: GoalStore;
  catalog: SkillCatalogReader;
  now: () => Date;
}

/**
 * Owner-only create (BR-15, BR-23, BR-34, BR-38). `ownerUid` is the verified subject from the route boundary.
 * Order is fixed by BR-23: title, date, SkillTree check, cap, write. The cap is count-then-create and
 * deliberately non-transactional (BR-34): concurrent creates may overshoot it and this is not prevented.
 */
export async function createPersonalGoal(
  ownerUid: string,
  input: CreatePersonalGoalInput,
  deps: CreatePersonalGoalDeps = {
    store: getDefaultGoalStore(),
    catalog: getDefaultSkillCatalogReader(),
    now: () => new Date(),
  },
): Promise<CreatePersonalGoalResult> {
  const title = normalizeGoalTitle(input.title);
  if (!title.ok) return { ok: false, error: "invalid_title" };
  if (input.targetDate !== undefined && !isValidGoalTargetDate(input.targetDate)) {
    return { ok: false, error: "invalid_target_date" };
  }

  try {
    let areaName: string | null = null;
    if (input.treeId !== undefined) {
      // Direct document-id read, never the selector window (BR-36d). An empty/non-string id is unknown.
      if (!isValidTreeIdShape(input.treeId)) return { ok: false, error: "skill_not_found" };
      const tree = await readSkillTreeName(input.treeId, deps.catalog);
      if (!tree.ok) return { ok: false, error: "persistence_failed" };
      if (tree.name === null) return { ok: false, error: "skill_not_found" };
      areaName = tree.name;
    }

    if ((await deps.store.count(ownerUid)) >= GOAL_LIMIT) return { ok: false, error: "goal_limit" };

    const goal = createGoal({ title: title.title, treeId: input.treeId, targetDate: input.targetDate }, deps.now());
    const id = await deps.store.create(ownerUid, goal);
    return { ok: true, dto: toGoalDto(id, goal, areaName) };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
