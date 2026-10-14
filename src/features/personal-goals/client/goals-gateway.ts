import { GOAL_DTO_KEYS, GOAL_LIST_RESPONSE_KEYS, GOAL_RECOVERY_DTO_KEYS } from "../domain/goal-constants";
import { isGoalStatus, type GoalDto, type GoalListResponse, type GoalStatus } from "../domain/goal";

/**
 * Browser gateway for the signed-in user's own goals (docs/features/personal-development-goals/SPEC.md —
 * BR-22, BR-23, BR-25, BR-53): thin `fetch` wrappers around `GET`/`POST /api/me/goals` and
 * `PATCH`/`DELETE /api/me/goals/[goalId]`. The subject is only the token's own
 * identity; no uid, e-mail or team is ever sent. Browser code never touches Firestore. The parser is
 * fail-closed: any unexpected shape becomes `read_failed`, never partially rendered data.
 */
export type FetchGoalsResult =
  | { status: "ok"; response: GoalListResponse }
  | { status: "unauthenticated" | "read_failed" };

const GOALS_URL = "/api/me/goals";

/** BR-22 request shapes. `PATCH`: absent leaves a field unchanged, `null` removes `treeId` / `targetDate`. */
export interface CreateGoalInput {
  title: string;
  treeId?: string;
  targetDate?: string;
}
export interface UpdateGoalInput {
  title?: string;
  treeId?: string | null;
  targetDate?: string | null;
  status?: GoalStatus;
}

/** Known BR-23 discriminators per method; anything else is `unknown`, never echoed. */
const CREATE_ERRORS = [
  "invalid_request",
  "invalid_title",
  "invalid_target_date",
  "skill_not_found",
  "goal_limit",
  "persistence_failed",
] as const;
const UPDATE_ERRORS = [
  "invalid_request",
  "invalid_title",
  "invalid_target_date",
  "skill_not_found",
  "goal_not_found",
  "clock_regressed",
  "persistence_failed",
] as const;

export type GoalMutationError = (typeof CREATE_ERRORS)[number] | (typeof UPDATE_ERRORS)[number] | "unknown";

/**
 * `unknown` and `persistence_failed` mean the write outcome is not known (a `PATCH` 500 can follow a committed
 * write, BR-23); callers must not claim that nothing was saved, and nothing here retries.
 */
export type GoalMutationResult =
  | { status: "ok"; goal: GoalDto }
  | { status: "unauthenticated" }
  | { status: "error"; error: GoalMutationError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";

function parseGoal(value: unknown): GoalDto | undefined {
  if (!isRecord(value) || !hasExactKeys(value, GOAL_DTO_KEYS)) return undefined;
  const { id, title, status, treeId, areaName, areaAvailable, targetDate, createdAt, updatedAt, completedAt } = value;
  if (typeof id !== "string" || id === "" || typeof title !== "string" || !isGoalStatus(status)) return undefined;
  if (!isNullableString(treeId) || !isNullableString(areaName) || !isNullableString(targetDate)) return undefined;
  if (typeof areaAvailable !== "boolean" || typeof createdAt !== "string" || typeof updatedAt !== "string") {
    return undefined;
  }
  if (!isNullableString(completedAt)) return undefined;
  // Derived-field consistency (BR-24): no link means available and unnamed; a link is available exactly when named.
  if (treeId === null && (areaName !== null || !areaAvailable)) return undefined;
  if (treeId !== null && areaAvailable !== (areaName !== null)) return undefined;
  return { id, title, status, treeId, areaName, areaAvailable, targetDate, createdAt, updatedAt, completedAt };
}

function parseGoalListResponse(body: unknown): GoalListResponse | undefined {
  if (!isRecord(body) || !hasExactKeys(body, GOAL_LIST_RESPONSE_KEYS)) return undefined;
  const { goals, recoveryItems, truncated, skillOptions, skillOptionsTruncated } = body;
  if (!Array.isArray(goals) || !Array.isArray(recoveryItems) || !Array.isArray(skillOptions)) return undefined;
  if (typeof truncated !== "boolean" || typeof skillOptionsTruncated !== "boolean") return undefined;

  const parsedGoals: GoalDto[] = [];
  for (const goal of goals) {
    const parsed = parseGoal(goal);
    if (!parsed) return undefined;
    parsedGoals.push(parsed);
  }
  const parsedRecovery: GoalListResponse["recoveryItems"] = [];
  for (const item of recoveryItems) {
    if (!isRecord(item) || !hasExactKeys(item, GOAL_RECOVERY_DTO_KEYS)) return undefined;
    if (typeof item.goalId !== "string" || item.goalId === "") return undefined;
    parsedRecovery.push({ goalId: item.goalId });
  }
  const parsedOptions: GoalListResponse["skillOptions"] = [];
  for (const option of skillOptions) {
    if (!isRecord(option) || !hasExactKeys(option, ["treeId", "name"])) return undefined;
    if (typeof option.treeId !== "string" || option.treeId === "" || typeof option.name !== "string") return undefined;
    parsedOptions.push({ treeId: option.treeId, name: option.name });
  }
  return {
    goals: parsedGoals,
    recoveryItems: parsedRecovery,
    truncated,
    skillOptions: parsedOptions,
    skillOptionsTruncated,
  };
}

/** Reads the caller's own goals. A 200 with an unexpected shape is a read failure, never an empty list. */
export async function fetchGoals(idToken: string): Promise<FetchGoalsResult> {
  try {
    const response = await fetch(GOALS_URL, { headers: { Authorization: `Bearer ${idToken}` } });
    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status !== 200) return { status: "read_failed" };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "read_failed" };
    }
    const parsed = parseGoalListResponse(body);
    return parsed ? { status: "ok", response: parsed } : { status: "read_failed" };
  } catch {
    return { status: "read_failed" };
  }
}

async function sendMutation(
  url: string,
  method: "POST" | "PATCH",
  idToken: string,
  body: CreateGoalInput | UpdateGoalInput,
  successStatus: number,
  knownErrors: readonly GoalMutationError[],
): Promise<GoalMutationResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 401) return { status: "unauthenticated" };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "error", error: "unknown" };
    }
    if (response.status === successStatus) {
      const goal = parseGoal(payload);
      return goal ? { status: "ok", goal } : { status: "error", error: "unknown" };
    }
    const code = isRecord(payload) ? payload.error : undefined;
    return { status: "error", error: knownErrors.find((error) => error === code) ?? "unknown" };
  } catch {
    return { status: "error", error: "unknown" };
  }
}

/** Creates a goal for the token's own identity (`POST`, 201). The body carries only title / treeId / targetDate. */
export function createGoal(idToken: string, input: CreateGoalInput): Promise<GoalMutationResult> {
  return sendMutation(GOALS_URL, "POST", idToken, input, 201, CREATE_ERRORS);
}

/** Applies a partial change to one own goal (`PATCH`, 200); also carries Complete / Reopen as `status`. */
export function updateGoal(idToken: string, goalId: string, input: UpdateGoalInput): Promise<GoalMutationResult> {
  return sendMutation(`${GOALS_URL}/${encodeURIComponent(goalId)}`, "PATCH", idToken, input, 200, UPDATE_ERRORS);
}

/**
 * `error` means the delete is not confirmed: `DELETE` is idempotent (BR-26) and a 500 can follow a committed
 * delete, so callers must not claim the goal still exists, and an explicit repeat is safe. Nothing retries.
 */
export type DeleteGoalResult =
  | { status: "ok" | "unauthenticated" }
  | { status: "error"; error: "unconfirmed" };

/** Permanently deletes one own goal or recovery item (`DELETE`, 200 `{ok:true}`); no request body. */
export async function deleteGoal(idToken: string, goalId: string): Promise<DeleteGoalResult> {
  try {
    const response = await fetch(`${GOALS_URL}/${encodeURIComponent(goalId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status !== 200) return { status: "error", error: "unconfirmed" };
    const payload: unknown = await response.json();
    return isRecord(payload) && hasExactKeys(payload, ["ok"]) && payload.ok === true
      ? { status: "ok" }
      : { status: "error", error: "unconfirmed" };
  } catch {
    return { status: "error", error: "unconfirmed" };
  }
}
