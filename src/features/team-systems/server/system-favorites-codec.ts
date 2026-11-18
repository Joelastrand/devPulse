import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";

/**
 * A personal system favorite is stored in the owner's personal subtree, one document per system id (Phase 2F.1, I-20). The
 * document id is the system id, and the owner is the path segment, so the record cannot be read or written for another
 * person through that subtree. Its content (the team id) is one v2 envelope bound to that exact path: a copy moved to another
 * owner, system or team fails to open.
 *
 * The stored document holds only the envelope and the time the favorite was set. It copies no system name, description,
 * classification or other business data: a favorite references an existing system and nothing else.
 */

export const FAVORITE_CONTENT_FIELD = "content";

type OpenEnvelope = (envelope: RecordEnvelope, context: string) => string;
type SealContent = (plaintext: string, context: string) => RecordEnvelope;

export function favoriteContext(ownerUid: string, systemId: string): string {
  return `system-favorite:${ownerUid}:${systemId}`;
}

/** The sealed content of a favorite. Only the team id is inside, because a system id is already the document id. */
export function sealFavoriteContent(ownerUid: string, systemId: string, teamId: string, seal: SealContent = encryptRecord): RecordEnvelope {
  return seal(JSON.stringify({ teamId }), favoriteContext(ownerUid, systemId));
}

/**
 * The team id of a stored favorite, or `null` when the record is not one this version can open (malformed, tampered,
 * substituted, or missing the content). An unusable record is ignored rather than shown. A key configuration failure is
 * rethrown, so it is never mistaken for a missing favorite.
 */
export function openFavoriteTeamId(
  ownerUid: string,
  systemId: string,
  data: unknown,
  open: OpenEnvelope = decryptRecord,
): string | null {
  if (typeof data !== "object" || data === null) return null;
  const envelope = readRecordEnvelope((data as Record<string, unknown>)[FAVORITE_CONTENT_FIELD]);
  if (envelope === null) return null;
  try {
    const parsed: unknown = JSON.parse(open(envelope, favoriteContext(ownerUid, systemId)));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const teamId = (parsed as Record<string, unknown>).teamId;
    return typeof teamId === "string" && teamId.length > 0 ? teamId : null;
  } catch (error) {
    if (error instanceof RecordEnvelopeError && (error.code === "authentication_failed" || error.code === "malformed")) {
      return null;
    }
    throw error;
  }
}
