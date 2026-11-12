/**
 * Collaborative (manual) team competence assessment of one canonical team skill (docs/archive/features/team-owned-skills/SPEC.md
 * §12; unified team competence decision, 2026-11-11).
 *
 * A team administrator records the level the team agreed on for one `teamSkills` area. It is a directly entered team-level
 * value: it is never an aggregate of private member data, so no k-threshold applies. It carries no member attribution:
 * `updatedBy` is audit metadata for the administrator only and is never returned to team-facing consumers.
 *
 * Pure: no Firestore access. Every value crossing a trust boundary is validated here, fail closed.
 */
import {
  isPlainObject,
  isTeamSkillLevel,
  isWellFormedTeamSkillId,
  type TeamSkillLevel,
} from "./team-skill";

export const TEAM_MANUAL_ASSESSMENTS_COLLECTION = "teamManualAssessments";
export const TEAM_MANUAL_NOTE_MAX = 300;

/** The persisted `teamManualAssessments/{teamId}__{skillId}` shape. Dates are `Date` after mapping. */
export interface TeamManualAssessmentRecord {
  teamId: string;
  skillId: string;
  level: TeamSkillLevel;
  note: string | null;
  /** The skill's criteria version when the agreed level was entered. A later guidance change flags it as outdated. */
  criteriaVersion: number;
  updatedAt: Date;
  /** Acting team administrator (audit only). Never returned to team-facing responses. Erased by A-18. */
  updatedBy: string;
}

/** Exact persisted key set. Compile-time checked against the record type below. */
export const TEAM_MANUAL_ASSESSMENT_PERSISTED_KEYS = {
  teamId: true,
  skillId: true,
  level: true,
  note: true,
  criteriaVersion: true,
  updatedAt: true,
  updatedBy: true,
} as const satisfies Record<keyof TeamManualAssessmentRecord, true>;

export type ManualAssessmentInputResult =
  | { ok: true; value: { level: TeamSkillLevel; note: string | null } }
  | { ok: false; error: "invalid_request" | "invalid_input" };

/** Deterministic document id. A uniqueness device only: never parsed apart, never proof of authorization. */
export function teamManualAssessmentDocId(teamId: string, skillId: string): string {
  return `${teamId}__${skillId}`;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * Fail-closed validation of a stored manual assessment. Extra or missing keys, a malformed identity, a document id that is
 * not `teamId__skillId`, an out-of-range level, an over-long note or a non-uid actor make the record invalid. Never throws.
 */
export function isValidTeamManualAssessment(
  data: unknown,
  context: { docId: string; teamId: string },
): data is TeamManualAssessmentRecord {
  try {
    if (!isPlainObject(data)) return false;
    const expected = Object.keys(TEAM_MANUAL_ASSESSMENT_PERSISTED_KEYS);
    if (Object.keys(data).length !== expected.length || !expected.every((key) => Object.hasOwn(data, key))) return false;
    const { teamId, skillId, level, note, criteriaVersion, updatedAt, updatedBy } = data;
    if (teamId !== context.teamId || !isWellFormedTeamSkillId(skillId)) return false;
    if (context.docId !== teamManualAssessmentDocId(context.teamId, skillId)) return false;
    if (!isTeamSkillLevel(level) || !isPositiveInteger(criteriaVersion) || !isValidDate(updatedAt)) return false;
    if (note !== null && (typeof note !== "string" || note.length > TEAM_MANUAL_NOTE_MAX)) return false;
    return typeof updatedBy === "string" && updatedBy.length > 0;
  } catch {
    return false;
  }
}

/** Trimmed note, or `null` when empty. Over-long or non-string input is refused, never truncated. */
function parseNote(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length > TEAM_MANUAL_NOTE_MAX) return { ok: false };
  return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

/** Body: exactly `{ level }` with an optional `note`. Unknown keys are refused. */
export function parseManualAssessmentBody(body: unknown): ManualAssessmentInputResult {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_request" };
  const allowed = new Set(["level", "note"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return { ok: false, error: "invalid_request" };
  if (!isTeamSkillLevel(body.level)) return { ok: false, error: "invalid_input" };
  const note = parseNote(body.note);
  if (!note.ok) return { ok: false, error: "invalid_input" };
  return { ok: true, value: { level: body.level, note: note.value } };
}
