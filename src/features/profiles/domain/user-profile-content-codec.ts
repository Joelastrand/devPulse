import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";

/**
 * Encryption of the display name in `userProfiles/{uid}`, the only business content of a profile. It is sealed as one v2
 * envelope bound to `user-profile:<uid>`, so a name cannot be moved to another profile.
 *
 * Plaintext stays for the document identity (the uid, which is the document id) and the timestamps.
 *
 * Fail-closed: a profile whose envelope is missing, malformed or fails authentication opens as `null`, which the profile
 * validator refuses. A document that still carries a plaintext display name is refused the same way.
 *
 * Lives in `domain/` because server readers in other features import the open function; the file itself is server-only.
 */

export const USER_PROFILE_CONTENT_FIELD = "content";
export type SealProfileContent = (plaintext: string, context: string) => RecordEnvelope;
export type OpenProfileContent = (envelope: RecordEnvelope, context: string) => string;

export function userProfileContext(uid: string): string {
  return `user-profile:${uid}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Persisted shape of one profile: timestamps plaintext, the display name sealed. */
export function toPersistedUserProfile(
  uid: string,
  record: Record<string, unknown> & { displayName: string },
  seal: SealProfileContent = encryptRecord,
): Record<string, unknown> {
  const { displayName, ...metadata } = record;
  return { ...metadata, [USER_PROFILE_CONTENT_FIELD]: seal(JSON.stringify({ displayName }), userProfileContext(uid)) };
}

/**
 * Opens a stored profile back to its plaintext shape. `undefined` for an absent document; `null` when the content cannot be
 * opened or when a plaintext display name is present.
 */
export function openUserProfileDocument(uid: string, data: unknown, open: OpenProfileContent = decryptRecord): unknown {
  if (data === undefined) return undefined;
  if (!isPlainRecord(data)) return null;
  const { [USER_PROFILE_CONTENT_FIELD]: sealed, ...metadata } = data;
  if (Object.hasOwn(metadata, "displayName")) return null;
  const envelope = readRecordEnvelope(sealed);
  if (envelope === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(open(envelope, userProfileContext(uid)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  if (!isPlainRecord(parsed) || typeof parsed.displayName !== "string") return null;
  return { ...metadata, displayName: parsed.displayName };
}
