import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";
import { isTeamSkillLevel, type TeamSkillLevel } from "../domain/team-skill";

/**
 * Encryption of the collaborative (agreed) team level and its note in `teamManualAssessments/{teamId}__{skillId}`.
 *
 * `level` and `note` are two v2 envelopes with different record contexts, so an envelope cannot be swapped between the
 * two fields or between skills and teams. `teamId`, `skillId`, `criteriaVersion`, `updatedAt` and `updatedBy` stay
 * plaintext: they are identifiers, version checks, the timestamp and the audit actor used by account erasure.
 *
 * `note: null` stays plaintext: it records only that no note was entered.
 *
 * Fail-closed: a missing key throws. A value that cannot be opened becomes `undefined`, so the domain validator classifies
 * the document as invalid. Plaintext values are never accepted.
 */

function levelContext(teamId: string, skillId: string): string {
  return `team-manual-assessment:level:${teamId}:${skillId}`;
}

function noteContext(teamId: string, skillId: string): string {
  return `team-manual-assessment:note:${teamId}:${skillId}`;
}

export function sealManualLevel(teamId: string, skillId: string, level: TeamSkillLevel): RecordEnvelope {
  return encryptRecord(JSON.stringify({ level }), levelContext(teamId, skillId));
}

export function sealManualNote(teamId: string, skillId: string, note: string): RecordEnvelope {
  return encryptRecord(JSON.stringify({ note }), noteContext(teamId, skillId));
}

/** Seals the persisted fields of a manual assessment; `note` stays `null` when absent. */
export function sealManualAssessmentFields(
  teamId: string,
  skillId: string,
  fields: { level: TeamSkillLevel; note: string | null },
): { level: RecordEnvelope; note: RecordEnvelope | null } {
  return {
    level: sealManualLevel(teamId, skillId, fields.level),
    note: fields.note === null ? null : sealManualNote(teamId, skillId, fields.note),
  };
}

/**
 * Opens one sealed field. Anything that is not an authenticated envelope of a valid value becomes `undefined`: the
 * validator refuses `undefined` for both fields, while `null` would be a valid "no note". Plaintext is never returned.
 */
function openField(value: unknown, context: string, key: "level" | "note", check: (v: unknown) => boolean): unknown {
  const envelope = readRecordEnvelope(value);
  if (envelope === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptRecord(envelope, context));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const inner = (parsed as Record<string, unknown>)[key];
  return check(inner) ? inner : undefined;
}

/** Opens `level` and `note` of a stored manual assessment. Unopenable or plaintext values become `undefined` (refused). */
export function openManualAssessmentDocument(teamId: string, skillId: string, data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  const out: Record<string, unknown> = { ...record };
  if (Object.hasOwn(record, "level")) {
    out.level = openField(record.level, levelContext(teamId, skillId), "level", isTeamSkillLevel);
  }
  if (Object.hasOwn(record, "note") && record.note !== null) {
    out.note = openField(record.note, noteContext(teamId, skillId), "note", (v) => typeof v === "string");
  }
  return out;
}
