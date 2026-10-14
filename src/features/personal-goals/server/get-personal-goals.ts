import "server-only";
import { toGoalDto, toGoalRecoveryDto, parseStoredGoal } from "../domain/goal";
import type { GoalDto, GoalListResponse, GoalRecoveryDto } from "../domain/goal";
import { GOAL_READ_WINDOW, isAddressableGoalId } from "../domain/goal-constants";
import { getDefaultGoalStore } from "./goal-store";
import type { GoalStore } from "./goal-store-types";
import { getDefaultSkillCatalogReader, readSkillOptions, resolveSkillNames } from "./skill-catalog";
import type { SkillCatalogReader } from "./skill-catalog";

export type GetPersonalGoalsResult =
  | { ok: true; dto: GoalListResponse }
  | { ok: false; error: "persistence_failed" };

export interface GetPersonalGoalsDeps {
  store: GoalStore;
  catalog: SkillCatalogReader;
}

/** Ids are restricted to the addressable shape (BR-63), so code-unit order equals code-point order. */
const byIdAscending = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Owner-only list (BR-25, BR-30, BR-58, BR-59). `ownerUid` is the verified subject supplied by the route
 * boundary; it is never read from client input. The reads are independent and not an atomic snapshot, so
 * the result is deduplicated defensively and any failure yields no partial envelope (BR-41).
 */
export async function getPersonalGoals(
  ownerUid: string,
  deps: GetPersonalGoalsDeps = { store: getDefaultGoalStore(), catalog: getDefaultSkillCatalogReader() },
): Promise<GetPersonalGoalsResult> {
  try {
    const [window, scan, options] = await Promise.all([
      deps.store.listWindow(ownerUid),
      deps.store.scanMissingCreatedAt(ownerUid),
      readSkillOptions(deps.catalog),
    ]);
    if (!options.ok) return { ok: false, error: "persistence_failed" };

    const parsed: Array<{ id: string; goal: Extract<ReturnType<typeof parseStoredGoal>, { ok: true }>["goal"] }> = [];
    const recoveryIds = new Set<string>();
    for (const { id, data } of window.docs.slice(0, GOAL_READ_WINDOW)) {
      if (!isAddressableGoalId(id)) continue;
      const result = parseStoredGoal(data);
      if (result.ok) parsed.push({ id, goal: result.goal });
      else recoveryIds.add(id);
    }
    for (const id of scan.missingCreatedAtIds.slice(0, GOAL_READ_WINDOW)) {
      if (isAddressableGoalId(id)) recoveryIds.add(id);
    }

    // Only valid goals' tree ids reach the catalog; direct resolution, never the selector window (BR-36d).
    const treeIds = [...new Set(parsed.flatMap(({ goal }) => (goal.treeId !== undefined ? [goal.treeId] : [])))];
    let names = new Map<string, string | null>();
    if (treeIds.length > 0) {
      const resolved = await resolveSkillNames(treeIds, deps.catalog);
      if (!resolved.ok) return { ok: false, error: "persistence_failed" };
      names = resolved.names;
    }

    const goalIds = new Set(parsed.map(({ id }) => id));
    const goals: GoalDto[] = parsed
      .sort(
        (a, b) =>
          b.goal.createdAt.getTime() - a.goal.createdAt.getTime() || byIdAscending(a.id, b.id),
      )
      .map(({ id, goal }) => toGoalDto(id, goal, goal.treeId !== undefined ? (names.get(goal.treeId) ?? null) : null));
    const recoveryItems: GoalRecoveryDto[] = [...recoveryIds]
      .filter((id) => !goalIds.has(id))
      .sort(byIdAscending)
      .map(toGoalRecoveryDto);

    return {
      ok: true,
      dto: {
        goals,
        recoveryItems,
        truncated: window.rawCount > GOAL_READ_WINDOW || scan.rawCount > GOAL_READ_WINDOW,
        skillOptions: options.options.map(({ treeId, name }) => ({ treeId, name })),
        skillOptionsTruncated: options.truncated,
      },
    };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
