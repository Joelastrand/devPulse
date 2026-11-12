import { isPlainObject, isTeamSkillLevel, isWellFormedTeamSkillId, type TeamSkillLevel } from "./team-skill";

/**
 * A person's private rating of one team skill (docs/archive/features/team-owned-skills/SPEC.md §3.2). One document per
 * (person, team skill): `teamSkillAssessments/{uid}__{skillId}`. Pure: no Firestore access.
 *
 * Why one document per rating rather than a map per person: a map keyed by skill id would need dynamic keys inside
 * `levels`, which the erasure guard admits only for its reviewed C1 shape. A document per rating needs no dynamic keys,
 * matches the `teamMemberships` id pattern, lets two skills be written concurrently without contention, and scales with
 * the ratings that exist rather than with every skill offered.
 */

export const TEAM_SKILL_ASSESSMENT_PERSISTED_KEYS = [
  "uid",
  "teamId",
  "skillId",
  "level",
  "criteriaVersion",
  "createdAt",
  "updatedAt",
] as const;

/** The persisted rating. `criteriaVersion` is the guidance version the rating was given under (SPEC §5). */
export interface TeamSkillAssessmentRecord {
  uid: string;
  teamId: string;
  skillId: string;
  level: TeamSkillLevel;
  criteriaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Uniqueness device only: never parsed back, never proof of ownership. Ownership is the stored `uid` field. */
export function teamSkillAssessmentDocId(uid: string, skillId: string): string {
  return `${uid}__${skillId}`;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Fail-closed validation of a stored rating. Exact key set; the id must match the document id; anything out of range
 * makes the document unreadable. Never throws, never repairs.
 */
export function isValidTeamSkillAssessment(
  data: unknown,
  context: { uid: string; skillId: string },
): data is TeamSkillAssessmentRecord {
  try {
    if (!isPlainObject(data)) return false;
    const expected = TEAM_SKILL_ASSESSMENT_PERSISTED_KEYS;
    if (Object.keys(data).length !== expected.length || !expected.every((key) => Object.hasOwn(data, key))) return false;
    if (!isWellFormedTeamSkillId(context.skillId) || data.skillId !== context.skillId) return false;
    if (data.uid !== context.uid || typeof data.teamId !== "string" || data.teamId.length === 0) return false;
    return (
      isTeamSkillLevel(data.level) &&
      Number.isInteger(data.criteriaVersion) &&
      (data.criteriaVersion as number) >= 1 &&
      isValidDate(data.createdAt) &&
      isValidDate(data.updatedAt)
    );
  } catch {
    return false;
  }
}

/** The fields a rating writes, as one persisted shape. */
export function toAssessmentRecord(input: {
  uid: string;
  teamId: string;
  skillId: string;
  level: TeamSkillLevel;
  criteriaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}): TeamSkillAssessmentRecord {
  return { ...input };
}
