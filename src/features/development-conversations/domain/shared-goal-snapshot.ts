import { isValidPlanDate } from "./plan-date";
import { isPlainObject, hasExactKeys, isNonEmptyString, parseCanonicalInstant } from "./stored-shape";
import { normalizeTitle } from "./text-rules";

/**
 * Stored shape of one goal snapshot (SPEC BR-25, BR-26). A snapshot is a copy taken when the owner selects a goal.
 * It carries no goal id, owner uid, participant uid or D1 access token, so it grants nothing and points at nothing.
 * It exists only inside the encrypted `sharedGoals` array (BR-51), so this parser reads the decrypted JSON form:
 * `capturedAt` is a canonical ISO string there and is returned as a `Date`.
 *
 * The status set is local, not imported from D1 (SPEC CL-5: D2 never imports D1 domain code).
 */
export const SHARED_GOAL_SNAPSHOT_KEYS = ["goalTitle", "treeId", "targetDate", "status", "capturedAt"] as const;

export const SNAPSHOT_GOAL_STATUSES = ["active", "completed"] as const;
export type SnapshotGoalStatus = (typeof SNAPSHOT_GOAL_STATUSES)[number];

export type SharedGoalSnapshot = {
  goalTitle: string;
  treeId: string | null;
  targetDate: string | null;
  status: SnapshotGoalStatus;
  capturedAt: Date;
};

export type ParseSharedGoalSnapshotResult = { ok: true; snapshot: SharedGoalSnapshot } | { ok: false };

/**
 * Validates one decrypted snapshot. Never repairs: a title that would be trimmed or normalised is rejected, so the
 * stored text is exactly the text that was validated. Errors carry no value.
 */
export function parseSharedGoalSnapshot(data: unknown): ParseSharedGoalSnapshotResult {
  if (!isPlainObject(data) || !hasExactKeys(data, SHARED_GOAL_SNAPSHOT_KEYS)) {
    return { ok: false };
  }
  const { goalTitle, treeId, targetDate, status, capturedAt } = data;

  if (typeof goalTitle !== "string") {
    return { ok: false };
  }
  const title = normalizeTitle(goalTitle);
  if (!title.ok || title.text !== goalTitle) {
    return { ok: false };
  }
  if (treeId !== null && !isNonEmptyString(treeId)) {
    return { ok: false };
  }
  if (targetDate !== null && !isValidPlanDate(targetDate)) {
    return { ok: false };
  }
  if (status !== "active" && status !== "completed") {
    return { ok: false };
  }
  const instant = parseCanonicalInstant(capturedAt);
  if (instant === null) {
    return { ok: false };
  }

  return {
    ok: true,
    snapshot: { goalTitle, treeId, targetDate, status, capturedAt: instant },
  };
}
