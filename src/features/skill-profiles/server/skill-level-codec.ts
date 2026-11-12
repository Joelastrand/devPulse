import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";
import { isSelfAssessedLevel, type SelfAssessedLevel } from "../domain/self-assessed-level";

/**
 * Encryption of one personal self-assessed level (the `levels.<treeId>` entry of a person's skill profile document).
 *
 * Each level is its own v2 record envelope, bound to `skill-profile:<uid>:<treeId>`, so a ciphertext cannot be moved to
 * another person's profile or another skill of the same profile. The tree id stays plaintext: it is the map key used for
 * per-skill merges and removals and carries no rating. Timestamps stay plaintext (operational metadata).
 *
 * Fail-closed rules:
 * - A missing or unusable `ENCRYPTION_KEY` throws (a configuration error, never hidden as an empty profile).
 * - A stored value that is not a v2 envelope, or fails authentication, is dropped as if absent. Plaintext numeric
 *   levels from before this codec are therefore never read (no legacy plaintext fallback).
 */

export function skillLevelContext(uid: string, treeId: string): string {
  return `skill-profile:${uid}:${treeId}`;
}

export function sealSkillLevel(uid: string, treeId: string, level: SelfAssessedLevel): RecordEnvelope {
  return encryptRecord(JSON.stringify({ level }), skillLevelContext(uid, treeId));
}

/**
 * Opens every stored level of one profile. Returns a plain map of valid levels only (`treeId -> level`). Entries that
 * are not envelopes, fail authentication, or decrypt to something other than a valid level are omitted, which the
 * domain already treats as "no level". Only own properties are considered.
 */
export function openSkillLevels(uid: string, levels: Readonly<Record<string, unknown>>): Record<string, SelfAssessedLevel> {
  const opened: Record<string, SelfAssessedLevel> = {};
  for (const treeId of Object.keys(levels)) {
    const level = openSkillLevel(uid, treeId, levels[treeId]);
    if (level !== null) opened[treeId] = level;
  }
  return opened;
}

function openSkillLevel(uid: string, treeId: string, value: unknown): SelfAssessedLevel | null {
  const envelope = readRecordEnvelope(value);
  if (envelope === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptRecord(envelope, skillLevelContext(uid, treeId)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const level = (parsed as Record<string, unknown>).level;
  return isSelfAssessedLevel(level) ? level : null;
}

/**
 * Opens the `levels` container of a raw profile document. A non-object `levels` is returned unchanged so the domain's
 * readability check still classifies the document as unreadable. Other document fields are passed through untouched.
 */
export function openSkillProfileDocument(
  uid: string,
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (data === undefined) return undefined;
  const levels = data.levels;
  if (levels === undefined || !isPlainRecord(levels)) return data;
  return { ...data, levels: openSkillLevels(uid, levels) };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
