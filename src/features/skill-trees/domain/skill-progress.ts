/**
 * The canonical, persisted `skillProgress/{teamId}__{treeId}` document
 * shape (docs/features/team-skill-tree/SPEC.md — "Data model"). Exactly one
 * team's tracking record against exactly one SkillTree — never a person's;
 * this feature has no individual-level data anywhere (SPEC — "Purpose").
 *
 * `teamId`/`treeId` are not derived from this record alone — callers
 * re-derive them from the caller's trusted route scope / the document's
 * deterministic composite id, never trust them merely because a candidate
 * object claims them, though the fields themselves are validated here as
 * part of the record shape.
 *
 * `currentNodeId` is `null` for "tracked, but not yet started" — the state
 * `startTeamSkillTracking` (TASK-003) creates — or a specific node's
 * `nodeId` once `updateTeamSkillProgress` has set one. `updatedBy` is the
 * *acting admin's* uid, persisted for internal accountability only, never
 * returned by any API response.
 */
export interface SkillProgressRecord {
  teamId: string;
  treeId: string;
  currentNodeId: string | null;
  updatedAt: Date;
  updatedBy: string;
}

/**
 * Builds the deterministic `skillProgress` document id for one (teamId,
 * treeId) pair (docs/features/team-skill-tree/SPEC.md — "Data model":
 * "deterministic composite key, mirrors `teamMemberships/{uid}__{teamId}`
 * and `teamSurveyState/{teamId}`"). Used only as a uniqueness/lookup key
 * when reading, writing, or deleting a specific team's progress against a
 * specific tree — never parsed back apart to recover `teamId`/`treeId` from
 * an arbitrary id string. The same (teamId, treeId) pair always resolves to
 * the same id; a different `teamId` or a different `treeId` always resolves
 * to a different id (mirrors `membershipDocId`'s identical contract).
 */
export function skillProgressDocId(teamId: string, treeId: string): string {
  return `${teamId}__${treeId}`;
}

/**
 * Fail-closed runtime validator for a candidate `SkillProgressRecord` —
 * the guard every later Firestore-reading task must go through before
 * treating raw document data as a `SkillProgressRecord`, instead of an
 * unchecked cast (`.claude/rules/typescript.md`). Callers are expected to
 * have already mapped a raw Firestore document into this candidate shape
 * (`Timestamp` fields → `Date`, exactly as this codebase's existing
 * Firestore-read call sites already do) — this module has no Firestore/I/O
 * dependency of its own.
 *
 * Returns `false` (never throws) for a missing/non-object candidate, a
 * missing/blank `teamId`/`treeId`/`updatedBy`, a missing/invalid
 * `updatedAt`, or a `currentNodeId` that is neither `null` nor a non-blank
 * string.
 */
export function isValidSkillProgress(data: unknown): data is SkillProgressRecord {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }

  const record = data as Record<string, unknown>;

  return (
    isNonEmptyString(record.teamId) &&
    isNonEmptyString(record.treeId) &&
    isValidCurrentNodeId(record.currentNodeId) &&
    isValidDate(record.updatedAt) &&
    isNonEmptyString(record.updatedBy)
  );
}

function isValidCurrentNodeId(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
