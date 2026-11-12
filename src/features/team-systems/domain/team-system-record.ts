/**
 * Persisted `teamSystems/{systemId}` shape (docs/archive/features/team-system-overview/
 * SPEC.md — D-1, BR-6). Stored data is untrusted until `parseTeamSystemRecord`
 * accepts it: a malformed document is skipped, never partially shown.
 */
import {
  ASSESSMENT_ATTRIBUTES,
  TEAM_SYSTEM_LIMITS,
  isAssessmentValue,
  parseBackstageUrl,
  type AssessmentAttribute,
  type AssessmentValue,
} from "./team-system";

export interface StoredAssessment {
  value: AssessmentValue;
  note: string | null;
  /** Server time of the last value/note change; `null` only for never-changed `ikke_vurdert` defaults. */
  assessedAt: Date | null;
  /** Caller uid of the last value/note change. Stored for traceability; never returned to clients. */
  assessedBy: string | null;
}

export type StoredAssessments = Record<AssessmentAttribute, StoredAssessment>;

export interface TeamSystemRecord {
  systemId: string;
  teamId: string;
  name: string;
  description: string | null;
  backstageUrl: string | null;
  assessments: StoredAssessments;
  knowledgeMemberRefs: string[];
  createdAt: Date;
  /** `null` once account erasure has anonymized the creator (A-13). The record is kept. */
  createdBy: string | null;
  updatedAt: Date;
  /** `null` once account erasure has anonymized the last editor (A-13). */
  updatedBy: string | null;
}

/** Default for an attribute that has never been assessed (BR-10: not a positive status). */
export const UNASSESSED: StoredAssessment = { value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null };

function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** `null` for an absent or erased actor, the string for a present one, `undefined` for a malformed value. */
function nullableActor(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return isNonEmptyString(value) ? value : undefined;
}

function parseAssessment(raw: unknown): StoredAssessment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isAssessmentValue(r.value)) return null;
  const note = r.note === undefined || r.note === null ? null : r.note;
  if (note !== null && (typeof note !== "string" || note.length > TEAM_SYSTEM_LIMITS.noteMax)) return null;
  const assessedAt = r.assessedAt === undefined || r.assessedAt === null ? null : r.assessedAt;
  if (assessedAt !== null && !isDate(assessedAt)) return null;
  const assessedBy = r.assessedBy === undefined || r.assessedBy === null ? null : r.assessedBy;
  if (assessedBy !== null && !isNonEmptyString(assessedBy)) return null;
  return { value: r.value, note, assessedAt, assessedBy };
}

/** Strict parse of one stored document belonging to `teamId`. `null` = skip this document. */
export function parseTeamSystemRecord(data: unknown, systemId: string, teamId: string): TeamSystemRecord | null {
  if (typeof data !== "object" || data === null) return null;
  const r = data as Record<string, unknown>;
  if (!isNonEmptyString(systemId) || r.teamId !== teamId) return null;
  if (!isNonEmptyString(r.name) || r.name.length > TEAM_SYSTEM_LIMITS.nameMax) return null;

  const description = r.description === undefined || r.description === null ? null : r.description;
  if (description !== null && (typeof description !== "string" || description.length > TEAM_SYSTEM_LIMITS.descriptionMax)) {
    return null;
  }
  // Re-validated on read (defense in depth): a stored URL that the write path would refuse is dropped, never rendered as a link.
  const storedUrl = r.backstageUrl === undefined || r.backstageUrl === null ? null : r.backstageUrl;
  if (storedUrl !== null && typeof storedUrl !== "string") return null;
  const parsedUrl = storedUrl === null ? { ok: true as const, value: null } : parseBackstageUrl(storedUrl);
  const backstageUrl = parsedUrl.ok ? parsedUrl.value : null;

  const assessments = {} as StoredAssessments;
  for (const attribute of ASSESSMENT_ATTRIBUTES) {
    // Legacy documents predate the newer attributes: an absent key is "not assessed", never a positive status (SPEC round 2, BR-18).
    if (r[attribute] === undefined || r[attribute] === null) {
      assessments[attribute] = { ...UNASSESSED };
      continue;
    }
    const parsed = parseAssessment(r[attribute]);
    if (parsed === null) return null;
    assessments[attribute] = parsed;
  }

  const refs = r.knowledgeMemberRefs;
  if (!Array.isArray(refs) || refs.length > TEAM_SYSTEM_LIMITS.knowledgeMembersMax) return null;
  if (!refs.every(isNonEmptyString)) return null;

  if (!isDate(r.createdAt) || !isDate(r.updatedAt)) return null;
  // Actor fields may be null after erasure (A-13, ANONYMIZE). A present value must still be a non-empty string.
  const createdBy = nullableActor(r.createdBy);
  const updatedBy = nullableActor(r.updatedBy);
  if (createdBy === undefined || updatedBy === undefined) return null;

  return {
    systemId,
    teamId,
    name: r.name,
    description: description as string | null,
    backstageUrl: backstageUrl as string | null,
    assessments,
    knowledgeMemberRefs: [...refs],
    createdAt: r.createdAt,
    createdBy,
    updatedAt: r.updatedAt,
    updatedBy,
  };
}

/**
 * BR-6 traceability: keeps the stored metadata of an unchanged assessment and
 * stamps `now`/`uid` only when the value or the note actually changes.
 */
export function traceAssessment(
  previous: StoredAssessment | undefined,
  next: { value: AssessmentValue; note: string | null },
  now: Date,
  uid: string,
): StoredAssessment {
  if (previous !== undefined && previous.value === next.value && previous.note === next.note) {
    return { ...previous };
  }
  return { value: next.value, note: next.note, assessedAt: now, assessedBy: uid };
}
