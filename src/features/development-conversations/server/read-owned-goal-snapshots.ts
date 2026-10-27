import "server-only";
import { getDefaultGoalStore } from "../../personal-goals/server/goal-store";
import type { ConversationErrorCode } from "../domain/errors";
import { SHARED_GOALS_MAX } from "../domain/conversation-constants";
import { isNonEmptyString, isPlainObject } from "../domain/stored-shape";
import { isValidPlanDate } from "../domain/plan-date";
import { normalizeTitle } from "../domain/text-rules";
import { SNAPSHOT_GOAL_STATUSES, type SharedGoalSnapshot, type SnapshotGoalStatus } from "../domain/shared-goal-snapshot";

/**
 * The only D2 code that reads D1 goals (SPEC BR-24 to BR-26, CL-5, IMPL-3). It returns snapshot material and nothing
 * else: no goal id, no D1 timestamps, no D1 domain type. The owner uid is always the verified one passed in by the
 * owner operation; this module never takes a uid from a request.
 *
 * Validation is D2's own (CL-5). A D1 goal is read raw and checked against D2's rules, and anything that does not
 * pass is `invalid_goal_selection`, never repaired.
 */

/** The one D1 read this seam needs. The D1 store satisfies it structurally, and tests supply a fake. */
export interface OwnedGoalReader {
  get(ownerUid: string, goalId: string): Promise<unknown>;
}

/**
 * Production wiring for the goal-set write (TASK-013, TASK-023). The route layer must not import the D1 store, so the
 * D1 read is supplied from this module, the only D2 importer of it.
 */
export function productionOwnedGoalReader(): OwnedGoalReader {
  // Only the `get` capability is handed out. The D1 store's create, update and delete methods are not reachable through
  // this object, even by a caller that widens its type (least privilege, TASK-023 S-3).
  const store = getDefaultGoalStore();
  return {
    get: (ownerUid, goalId) => store.get(ownerUid, goalId),
  };
}

export interface OwnedGoalSnapshotDeps {
  goalStore: OwnedGoalReader;
  /** Server time at capture (BR-25). Injected so tests can fix it. */
  clock: () => Date;
}

export type OwnedGoalSnapshotsError = Extract<ConversationErrorCode, "invalid_goal_selection" | "persistence_failed">;

export type OwnedGoalSnapshotsResult = { ok: true; snapshots: SharedGoalSnapshot[] } | { ok: false; error: OwnedGoalSnapshotsError };

/**
 * D2's local goal-id rule (AD-3 segment grammar, applied to D1 goal ids because they become Firestore path segments).
 * Ids are never trimmed or repaired; an id that is not addressable is rejected before any read.
 */
const GOAL_ID_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

function isAddressableGoalId(value: unknown): value is string {
  return typeof value === "string" && GOAL_ID_SEGMENT.test(value) && !value.includes("__");
}

/** Validates the request selection: 1 to 5 distinct addressable ids. Returns the ids, or `null` when invalid. */
function validSelection(goalIds: unknown): string[] | null {
  if (!Array.isArray(goalIds) || goalIds.length < 1 || goalIds.length > SHARED_GOALS_MAX) {
    return null;
  }
  if (!goalIds.every(isAddressableGoalId) || new Set(goalIds).size !== goalIds.length) {
    return null;
  }
  return goalIds;
}

function isSnapshotStatus(value: unknown): value is SnapshotGoalStatus {
  return (SNAPSHOT_GOAL_STATUSES as readonly unknown[]).includes(value);
}

/**
 * Validates one raw D1 goal and maps it to snapshot material (BR-25). Only the fields the snapshot carries are
 * checked: title, status, optional treeId and optional targetDate. Returns `null` for anything malformed.
 */
function toSnapshotMaterial(raw: unknown): Omit<SharedGoalSnapshot, "capturedAt"> | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  const { title, status, treeId, targetDate } = raw;

  if (typeof title !== "string") {
    return null;
  }
  const normalized = normalizeTitle(title);
  if (!normalized.ok || normalized.text !== title) {
    return null;
  }
  if (!isSnapshotStatus(status)) {
    return null;
  }
  if (treeId !== undefined && !isNonEmptyString(treeId)) {
    return null;
  }
  if (targetDate !== undefined && !isValidPlanDate(targetDate)) {
    return null;
  }

  return {
    goalTitle: title,
    treeId: treeId ?? null,
    targetDate: targetDate ?? null,
    status,
  };
}

/**
 * Reads the owner's selected D1 goals and returns one snapshot each, in request order. The whole selection is
 * all-or-nothing: any invalid, absent or malformed goal rejects the request and returns no snapshot. A read failure
 * rejects with `persistence_failed` and is never reported as absence.
 */
export async function readOwnedGoalSnapshots(
  ownerUid: string,
  goalIds: unknown,
  deps: OwnedGoalSnapshotDeps = { goalStore: getDefaultGoalStore(), clock: () => new Date() },
): Promise<OwnedGoalSnapshotsResult> {
  const ids = validSelection(goalIds);
  if (ids === null) {
    return { ok: false, error: "invalid_goal_selection" };
  }

  const capturedAt = deps.clock();
  const snapshots: SharedGoalSnapshot[] = [];
  for (const goalId of ids) {
    let raw: unknown;
    try {
      raw = await deps.goalStore.get(ownerUid, goalId);
    } catch {
      return { ok: false, error: "persistence_failed" };
    }
    if (raw === undefined) {
      return { ok: false, error: "invalid_goal_selection" };
    }
    const material = toSnapshotMaterial(raw);
    if (material === null) {
      return { ok: false, error: "invalid_goal_selection" };
    }
    snapshots.push({ ...material, capturedAt: new Date(capturedAt.getTime()) });
  }

  return { ok: true, snapshots };
}
