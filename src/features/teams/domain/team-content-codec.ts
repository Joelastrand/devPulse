import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";

/**
 * Encryption of a team's company-authored content in `teams/{teamId}`: the team name. It is sealed as one v2 envelope bound
 * to `team:<teamId>`, so the name cannot be moved to another team.
 *
 * Plaintext stays for the team identifier, status, visibility, the creation timestamp and the creating admin's uid. Those
 * drive team listing, membership checks and superadmin administration, and none of them is free text.
 *
 * Fail-closed: a document whose envelope is missing, malformed or fails authentication opens as `null`, which the team
 * validators refuse. A document that still carries a plaintext name is refused the same way.
 *
 * Lives in `domain/` because server readers in other features import the open function; the file itself is server-only.
 */

export const TEAM_CONTENT_FIELD = "content";
export type SealTeamContent = (plaintext: string, context: string) => RecordEnvelope;
export type OpenTeamContent = (envelope: RecordEnvelope, context: string) => string;

export function teamContentContext(teamId: string): string {
  return `team:${teamId}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Persisted shape of one team: plaintext metadata plus the sealed name. */
export function toPersistedTeam(
  teamId: string,
  record: Record<string, unknown> & { name: string },
  seal: SealTeamContent = encryptRecord,
): Record<string, unknown> {
  const { name, ...metadata } = record;
  return { ...metadata, [TEAM_CONTENT_FIELD]: seal(JSON.stringify({ name }), teamContentContext(teamId)) };
}

/**
 * Opens a stored team back to its plaintext shape. `undefined` for an absent document; `null` when the content cannot be
 * opened or when a plaintext name is present.
 */
export function openTeamDocument(teamId: string, data: unknown, open: OpenTeamContent = decryptRecord): unknown {
  if (data === undefined) return undefined;
  if (!isPlainRecord(data)) return null;
  const { [TEAM_CONTENT_FIELD]: sealed, ...metadata } = data;
  if (Object.hasOwn(metadata, "name")) return null;
  const envelope = readRecordEnvelope(sealed);
  if (envelope === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(open(envelope, teamContentContext(teamId)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  if (!isPlainRecord(parsed) || typeof parsed.name !== "string") return null;
  return { ...metadata, name: parsed.name };
}
