import { isWellFormedTreeId } from "../../skill-profiles/domain/skill-profile";

/**
 * Team competence area assignment (docs/features/team-experience-redesign SPEC — BR-18, AD-2; TASK-007).
 *
 * A team assigns global competence areas from the existing `skillTrees` catalog to itself, orders them, and sets each
 * assignment active, inactive or archived. The catalog itself is admin-owned: a team lead never renames or creates an
 * area. An archived assignment is terminal and is never deleted, so the team's history stays readable. The record holds
 * team-level state only: no uid, no actor, and no rating, level or count of any member.
 */

export const COMPETENCE_AREA_STATUSES = ["active", "inactive", "archived"] as const;
export type CompetenceAreaStatus = (typeof COMPETENCE_AREA_STATUSES)[number];

/** Upper bound of assignments per team (active, inactive and archived together). A repository choice. */
export const COMPETENCE_AREAS_PER_TEAM_MAX = 100;

/** The persisted `teamCompetenceAreas/{teamId}__{treeId}` shape. */
export interface CompetenceAreaRecord {
  teamId: string;
  treeId: string;
  status: CompetenceAreaStatus;
  /** Zero-based position among the team's assignments. Reorder rewrites it as a permutation of the non-archived set. */
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Compile-time exhaustive key map: adding or removing a field fails typecheck. */
export const COMPETENCE_AREA_PERSISTED_KEYS = {
  teamId: true,
  treeId: true,
  status: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Record<keyof CompetenceAreaRecord, true>;

/** Deterministic document id: a uniqueness device ONLY. Never parsed apart, never proof of authorization. */
export function competenceAreaDocId(teamId: string, treeId: string): string {
  return `${teamId}__${treeId}`;
}

export function isCompetenceAreaStatus(value: unknown): value is CompetenceAreaStatus {
  return typeof value === "string" && (COMPETENCE_AREA_STATUSES as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Fail-closed validation of a stored assignment. Timestamps must already be `Date`. Extra or missing keys, a malformed
 * identity, a document id that is not `teamId__treeId`, an unknown status or an out-of-range order are all invalid.
 * Never throws.
 */
export function isValidCompetenceArea(data: unknown, context: { docId: string }): data is CompetenceAreaRecord {
  try {
    if (!isPlainObject(data)) return false;
    const expected = Object.keys(COMPETENCE_AREA_PERSISTED_KEYS);
    if (Object.keys(data).length !== expected.length || !expected.every((key) => Object.hasOwn(data, key))) return false;
    const { teamId, treeId, status, sortOrder, createdAt, updatedAt } = data;
    if (typeof teamId !== "string" || teamId.length === 0) return false;
    if (!isWellFormedTreeId(treeId)) return false;
    if (context.docId !== competenceAreaDocId(teamId, treeId)) return false;
    return (
      isCompetenceAreaStatus(status) &&
      Number.isInteger(sortOrder) &&
      (sortOrder as number) >= 0 &&
      (sortOrder as number) < COMPETENCE_AREAS_PER_TEAM_MAX &&
      isValidDate(createdAt) &&
      isValidDate(updatedAt)
    );
  } catch {
    return false;
  }
}

/** Status change rules. An archived assignment is terminal; any other change to it is refused. */
export type CompetenceAreaTransitionResult = { ok: true; changed: boolean } | { ok: false; error: "area_archived" };

export function transitionCompetenceAreaStatus(
  from: CompetenceAreaStatus,
  to: CompetenceAreaStatus,
): CompetenceAreaTransitionResult {
  if (from === "archived") return { ok: false, error: "area_archived" };
  return { ok: true, changed: from !== to };
}

export type CompetenceAreaInputResult<T> = { ok: true; value: T } | { ok: false; error: "invalid_request" | "invalid_input" };

/** Assign body: exactly `{ treeId }`. Unknown keys are an envelope error; a malformed id is an input error. */
export function parseAssignCompetenceAreaBody(body: unknown): CompetenceAreaInputResult<{ treeId: string }> {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "treeId")) return { ok: false, error: "invalid_request" };
  if (!isWellFormedTreeId(body.treeId)) return { ok: false, error: "invalid_input" };
  return { ok: true, value: { treeId: body.treeId } };
}

/** Status body: exactly `{ status }`. */
export function parseCompetenceAreaStatusBody(body: unknown): CompetenceAreaInputResult<{ status: CompetenceAreaStatus }> {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "status")) return { ok: false, error: "invalid_request" };
  if (!isCompetenceAreaStatus(body.status)) return { ok: false, error: "invalid_input" };
  return { ok: true, value: { status: body.status } };
}

/** Order body: exactly `{ order: treeId[] }`, unique well-formed ids, at most the per-team maximum. */
export function parseCompetenceAreaOrderBody(body: unknown): CompetenceAreaInputResult<{ order: string[] }> {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "order")) return { ok: false, error: "invalid_request" };
  const order = body.order;
  if (!Array.isArray(order) || order.length > COMPETENCE_AREAS_PER_TEAM_MAX) return { ok: false, error: "invalid_input" };
  if (!order.every(isWellFormedTreeId)) return { ok: false, error: "invalid_input" };
  if (new Set(order).size !== order.length) return { ok: false, error: "invalid_input" };
  return { ok: true, value: { order: [...order] } };
}
