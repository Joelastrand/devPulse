import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";

/**
 * Encryption of a team's tracked stage in `skillProgress/{teamId}__{treeId}`.
 *
 * Sealed business value: `currentNodeId`, the team's current stage in a competence area. It is business content, so it is
 * not readable from storage. It is nullable: a tracked tree that has not been reported yet has `null`, and that state is
 * sealed too.
 *
 * Plaintext metadata, each with a reason: `teamId` and `treeId` (the query key for the team listing and the identity the
 * document id is built from), `updatedAt` (audit timestamp), `updatedBy` (accountability; nulled by account erasure).
 *
 * Every writer replaces the whole sealed value, so no read-modify-write is needed. The envelope is bound to
 * `skill-progress:<teamId>:<treeId>`, so a stage cannot be moved to another team or area. Fail-closed: a document without a
 * valid envelope, or whose envelope fails authentication, opens as `null`, which the domain validator refuses. A document that
 * still carries a plaintext `currentNodeId` is refused the same way.
 */

export const SKILL_PROGRESS_CONTENT_FIELD = "content";
export type SealSkillProgress = (plaintext: string, context: string) => RecordEnvelope;
export type OpenSkillProgress = (envelope: RecordEnvelope, context: string) => string;

export function skillProgressContext(teamId: string, treeId: string): string {
  return `skill-progress:${teamId}:${treeId}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The sealed field set written on every change of a team's stage. */
export function skillProgressContentUpdate(
  teamId: string,
  treeId: string,
  currentNodeId: string | null,
  seal: SealSkillProgress = encryptRecord,
): { [SKILL_PROGRESS_CONTENT_FIELD]: RecordEnvelope } {
  return { [SKILL_PROGRESS_CONTENT_FIELD]: seal(JSON.stringify({ currentNodeId }), skillProgressContext(teamId, treeId)) };
}

/** Persisted shape of one progress record: metadata plaintext, the stage sealed. */
export function toPersistedSkillProgress(
  record: { teamId: string; treeId: string; currentNodeId: string | null } & Record<string, unknown>,
  seal: SealSkillProgress = encryptRecord,
): Record<string, unknown> {
  const { currentNodeId, ...metadata } = record;
  return { ...metadata, ...skillProgressContentUpdate(record.teamId, record.treeId, currentNodeId, seal) };
}

/**
 * Opens a stored progress record back to its domain shape. `undefined` for an absent document; `null` when the stage cannot
 * be opened or a plaintext stage is present.
 */
export function openSkillProgressDocument(data: unknown, open: OpenSkillProgress = decryptRecord): unknown {
  if (data === undefined) return undefined;
  if (!isPlainRecord(data)) return null;
  const { [SKILL_PROGRESS_CONTENT_FIELD]: sealed, ...metadata } = data;
  if (Object.hasOwn(metadata, "currentNodeId")) return null;
  if (typeof metadata.teamId !== "string" || typeof metadata.treeId !== "string") return null;
  const envelope = readRecordEnvelope(sealed);
  if (envelope === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(open(envelope, skillProgressContext(metadata.teamId, metadata.treeId)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  if (!isPlainRecord(parsed) || !("currentNodeId" in parsed)) return null;
  // Shape only: the domain validator (`isValidSkillProgress`) decides whether the restored stage is acceptable.
  return { ...metadata, currentNodeId: parsed.currentNodeId };
}
