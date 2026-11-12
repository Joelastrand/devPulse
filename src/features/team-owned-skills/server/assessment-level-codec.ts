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
 * Encryption of one person's private team-skill rating (the `level` field of `teamSkillAssessments/{uid}__{skillId}`).
 *
 * The rating is one v2 record envelope bound to `team-skill-assessment:<uid>:<teamId>:<skillId>`. A ciphertext moved to
 * another person, another team or another skill fails authentication. The document id, `teamId`, `skillId`,
 * `criteriaVersion` and timestamps stay plaintext: they are identifiers and operational metadata used by queries and by
 * the criteria-version check.
 *
 * Fail-closed rules:
 * - A missing or unusable `ENCRYPTION_KEY` throws; it is never hidden as a missing rating.
 * - A `level` that is not a v2 envelope, or fails authentication, is replaced by `null`. The domain validator then
 *   classifies the document as unreadable (the batch reader marks the skill suspect; the personal write paths refuse).
 *   Plaintext levels are never accepted (no plaintext fallback).
 */

export function assessmentLevelContext(uid: string, teamId: string, skillId: string): string {
  return `team-skill-assessment:${uid}:${teamId}:${skillId}`;
}

export function sealAssessmentLevel(uid: string, teamId: string, skillId: string, level: TeamSkillLevel): RecordEnvelope {
  return encryptRecord(JSON.stringify({ level }), assessmentLevelContext(uid, teamId, skillId));
}

/** Replaces an envelope `level` with its plaintext value, or with `null` when it cannot be opened. */
export function openAssessmentDocument(
  uid: string,
  teamId: string,
  skillId: string,
  data: unknown,
): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (!Object.hasOwn(record, "level")) return data;
  return { ...record, level: openAssessmentLevel(uid, teamId, skillId, record.level) };
}

function openAssessmentLevel(uid: string, teamId: string, skillId: string, value: unknown): TeamSkillLevel | null {
  const envelope = readRecordEnvelope(value);
  if (envelope === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptRecord(envelope, assessmentLevelContext(uid, teamId, skillId)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const level = (parsed as Record<string, unknown>).level;
  return isTeamSkillLevel(level) ? level : null;
}
