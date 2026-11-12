import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";

/**
 * Encryption of a team's skill requirement in `teamSkillNeeds/{teamId}__{treeId}`.
 *
 * Sealed business values: `requiredLevel` and `requiredCoverage`. They state what the team needs in a competence area, which
 * is business content and must not be readable from storage.
 *
 * Plaintext metadata, each with a reason: `teamId` and `treeId` (the query key for the team listing, and the identity the
 * document id is built from), `createdAt` and `updatedAt` (technical audit timestamps).
 *
 * The envelope is bound to `team-skill-need:<teamId>:<treeId>`, so a sealed requirement cannot be moved to another team or
 * area. Fail-closed: a document without a valid envelope, or whose envelope fails authentication, opens as `null`. A document
 * that still carries a plaintext requirement is refused the same way.
 */

export const SKILL_NEED_CONTENT_FIELD = "content";
const SEALED_KEYS = ["requiredLevel", "requiredCoverage"] as const;
export type SealSkillNeed = (plaintext: string, context: string) => RecordEnvelope;
export type OpenSkillNeed = (envelope: RecordEnvelope, context: string) => string;

export function skillNeedContentContext(teamId: string, treeId: string): string {
  return `team-skill-need:${teamId}:${treeId}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Persisted shape of one need: metadata plaintext, the two requirement values sealed together. */
export function toPersistedSkillNeed(
  record: { teamId: string; treeId: string; requiredLevel: unknown; requiredCoverage: unknown } & Record<string, unknown>,
  seal: SealSkillNeed = encryptRecord,
): Record<string, unknown> {
  const { requiredLevel, requiredCoverage, ...metadata } = record;
  const sealed = seal(JSON.stringify({ requiredLevel, requiredCoverage }), skillNeedContentContext(record.teamId, record.treeId));
  return { ...metadata, [SKILL_NEED_CONTENT_FIELD]: sealed };
}

/**
 * Opens a stored need back to its domain shape. `undefined` for an absent document; `null` when the values cannot be
 * opened or a plaintext value is present.
 */
export function openSkillNeedDocument(data: unknown, open: OpenSkillNeed = decryptRecord): unknown {
  if (data === undefined) return undefined;
  if (!isPlainRecord(data)) return null;
  const { [SKILL_NEED_CONTENT_FIELD]: sealed, ...metadata } = data;
  if (SEALED_KEYS.some((key) => Object.hasOwn(metadata, key))) return null;
  if (typeof metadata.teamId !== "string" || typeof metadata.treeId !== "string") return null;
  const envelope = readRecordEnvelope(sealed);
  if (envelope === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(open(envelope, skillNeedContentContext(metadata.teamId, metadata.treeId)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  if (!isPlainRecord(parsed)) return null;
  // Shape only: the domain validator (`isValidSkillNeed`) decides whether the restored values are acceptable.
  return { ...metadata, requiredLevel: parsed.requiredLevel, requiredCoverage: parsed.requiredCoverage };
}
