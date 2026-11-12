import "server-only";
import { blindIndex } from "../../../lib/encryption/blind-index";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";
import { invitationDocId } from "./team-invitation";
import { normalizeEmail } from "./normalize-email";

/**
 * Storage of a team invitation's email in `teamInvitations/{docId}`.
 *
 * - The email is sealed as one v2 envelope (`content`), bound to `team-invitation:<teamId>:<emailIndex>`, so it cannot be
 *   moved to another invitation, team or index.
 * - Matching uses `emailIndex`: a keyed blind index (HMAC-SHA-256 under a purpose-derived HKDF key) of the normalized email.
 *   The document id is `<teamId>__<emailIndex>`, so duplicate detection and lookup stay deterministic without a plaintext
 *   or unkeyed email anywhere in the document.
 * - There is no plaintext email field and no deterministic encryption of the email. The index is the only searchable value.
 *
 * Fail-closed: a document without a valid envelope, or whose envelope fails authentication, opens as `null`. A document
 * that still carries a plaintext email is refused the same way.
 *
 * Lives in `domain/` because the account-erasure feature imports the index function; the file itself is server-only.
 */

export const INVITATION_CONTENT_FIELD = "content";
export const INVITATION_EMAIL_INDEX_FIELD = "emailIndex";
export type SealInvitationEmail = (plaintext: string, context: string) => RecordEnvelope;
export type OpenInvitationEmail = (envelope: RecordEnvelope, context: string) => string;

/** The blind index of an email (normalized first). Synchronous; throws when the index key is unavailable. */
export function invitationEmailIndex(email: string): string {
  return blindIndex("team-invitation-email", normalizeEmail(email));
}

/** The `teamInvitations` document id of one (team, email) pair. */
export function invitationDocIdForEmail(teamId: string, email: string): string {
  return invitationDocId(teamId, invitationEmailIndex(email));
}

export function invitationContext(teamId: string, emailIndex: string): string {
  return `team-invitation:${teamId}:${emailIndex}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Persisted shape of one invitation: plaintext metadata, the index, and the sealed normalized email. */
export function toPersistedInvitation(
  teamId: string,
  record: Record<string, unknown> & { email: string },
  seal: SealInvitationEmail = encryptRecord,
): Record<string, unknown> {
  const { email, ...metadata } = record;
  const emailIndex = invitationEmailIndex(email);
  const sealed = seal(JSON.stringify({ email: normalizeEmail(email) }), invitationContext(teamId, emailIndex));
  return { ...metadata, teamId, [INVITATION_EMAIL_INDEX_FIELD]: emailIndex, [INVITATION_CONTENT_FIELD]: sealed };
}

/**
 * Opens a stored invitation back to its plaintext shape. `undefined` for an absent document; `null` when the email cannot
 * be opened, when a plaintext email is present, or when the index is missing.
 */
export function openInvitationDocument(teamId: string, data: unknown, open: OpenInvitationEmail = decryptRecord): unknown {
  if (data === undefined) return undefined;
  if (!isPlainRecord(data)) return null;
  const { [INVITATION_CONTENT_FIELD]: sealed, ...metadata } = data;
  if (Object.hasOwn(metadata, "email")) return null;
  const emailIndex = metadata[INVITATION_EMAIL_INDEX_FIELD];
  if (typeof emailIndex !== "string" || emailIndex.length === 0) return null;
  const envelope = readRecordEnvelope(sealed);
  if (envelope === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(open(envelope, invitationContext(teamId, emailIndex)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  if (!isPlainRecord(parsed) || typeof parsed.email !== "string") return null;
  const domainMetadata = Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== INVITATION_EMAIL_INDEX_FIELD));
  return { ...domainMetadata, email: parsed.email };
}

/** Opens a stored invitation using the team recorded in its own plaintext metadata. `null` when that team is missing. */
export function openStoredInvitation(data: unknown, open: OpenInvitationEmail = decryptRecord): unknown {
  if (data === undefined) return undefined;
  if (!isPlainRecord(data) || typeof data.teamId !== "string") return null;
  return openInvitationDocument(data.teamId, data, open);
}
