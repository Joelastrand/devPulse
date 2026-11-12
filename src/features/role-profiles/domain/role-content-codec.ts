import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";

/**
 * Encryption of an organizational role's authored content in the role store's document `{roleId}`: the title (`name`) and the
 * `description`. They are sealed together as one v2 envelope bound to `role:<roleId>`, so the content cannot be moved to
 * another role.
 *
 * Plaintext stays for the lifecycle and audit fields (`createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `archivedAt`,
 * `archivedBy`). A formal role grants no application permission; these fields are never authorization evidence.
 *
 * Fail-closed: when the envelope is missing, malformed or fails authentication, `openRoleDocument` returns the metadata
 * without a name. The role validator requires a name, so such a role is refused rather than repaired. A document that still
 * carries a plaintext name or description is refused the same way.
 *
 * Lives in `domain/` because the store imports it; the file itself is server-only.
 */

export const ROLE_CONTENT_FIELD = "content";
/** The fields that are sealed. Every other role field is plaintext metadata. */
export const ROLE_SEALED_FIELDS: ReadonlySet<string> = new Set(["name", "description"]);

export type SealRoleContent = (plaintext: string, context: string) => RecordEnvelope;
export type OpenRoleContent = (envelope: RecordEnvelope, context: string) => string;

export function roleContext(roleId: string): string {
  return `role:${roleId}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Splits persisted role fields into plaintext metadata and the sealed content object (name and description only). */
export function splitRoleContent(data: Record<string, unknown>): {
  metadata: Record<string, unknown>;
  content: { name?: unknown; description?: unknown };
} {
  const { name, description, ...metadata } = data;
  const content: { name?: unknown; description?: unknown } = {};
  if (name !== undefined) content.name = name;
  if (description !== undefined) content.description = description;
  return { metadata, content };
}

/** Persisted shape of one role: metadata plaintext, name and description sealed. */
export function toPersistedRole(roleId: string, data: Record<string, unknown>, seal: SealRoleContent = encryptRecord): Record<string, unknown> {
  const { metadata, content } = splitRoleContent(data);
  return { ...metadata, [ROLE_CONTENT_FIELD]: seal(JSON.stringify(content), roleContext(roleId)) };
}

/**
 * Opens a stored role. The result carries the metadata and, when the envelope opens, `name` and `description` (when present
 * in the content). On any failure the result carries the metadata only, so the role validator refuses it.
 */
export function openRoleDocument(roleId: string, data: Record<string, unknown>, open: OpenRoleContent = decryptRecord): Record<string, unknown> {
  const { [ROLE_CONTENT_FIELD]: sealed, ...rest } = data;
  const metadata = Object.fromEntries(Object.entries(rest).filter(([key]) => !ROLE_SEALED_FIELDS.has(key)));
  if (Object.keys(rest).some((key) => ROLE_SEALED_FIELDS.has(key))) return metadata;
  const envelope = readRecordEnvelope(sealed);
  if (envelope === null) return metadata;
  let parsed: unknown;
  try {
    parsed = JSON.parse(open(envelope, roleContext(roleId)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return metadata;
  }
  if (!isPlainRecord(parsed)) return metadata;
  return {
    ...metadata,
    ...(parsed.name !== undefined ? { name: parsed.name } : {}),
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
  };
}
