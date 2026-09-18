/**
 * The exact key-version literal `src/lib/encryption/encryption.ts` ever
 * produces. Declared independently here (not imported from that module) so
 * this domain module stays framework/I-O free (docs/features/team-forum/
 * SPEC.md — "Data model").
 */
export type ForumReplyKeyVersion = "v1";

const FORUM_REPLY_KEY_VERSION: ForumReplyKeyVersion = "v1";

/**
 * A `forumReplies/{replyId}` document while active (docs/features/
 * team-forum/SPEC.md — "Data model"). `replyId`/`threadId`-as-a-route-param
 * are not fields of this type — `threadId` here is the value denormalized
 * onto the document itself (BR-35), independently cross-checked against the
 * parent thread's own `teamId` by later tasks.
 */
export interface ActiveForumReply {
  teamId: string;
  threadId: string;
  authorUid: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: ForumReplyKeyVersion;
  createdAt: Date;
}

/**
 * A `forumReplies/{replyId}` document after `deleteReply` (docs/features/
 * team-forum/SPEC.md — "Data model", BR-26). `ciphertext`/`iv`/`authTag`/
 * `keyVersion`/`authorUid` are not optional-and-absent here — they are
 * structurally not part of this type at all, so nothing in this codebase can
 * accidentally read plaintext-adjacent fields off a tombstone.
 */
export interface TombstonedForumReply {
  teamId: string;
  threadId: string;
  createdAt: Date;
  deletedAt: Date;
  deletedBy: string;
}

/**
 * A reply document is valid only in one of these two shapes (BR-56) — never
 * one type with optional fields, which would let a partially-populated,
 * corrupt document type-check by accident.
 */
export type ForumReplyRecord = ActiveForumReply | TombstonedForumReply;

const ACTIVE_ONLY_FIELDS = [
  "authorUid",
  "ciphertext",
  "iv",
  "authTag",
  "keyVersion",
] as const;

const TOMBSTONE_ONLY_FIELDS = ["deletedAt", "deletedBy"] as const;

/**
 * Fail-closed runtime validator for a candidate `forumReplies` document
 * (docs/features/team-forum/SPEC.md — BR-56). Never throws.
 *
 * Accepts only a candidate matching exactly one of the two documented
 * shapes: a well-formed active shape (every active field present and
 * well-typed, no tombstone-only field present) or a well-formed tombstone
 * shape (every tombstone field present and well-typed, no active-only field
 * present). A candidate carrying fields from both shapes (e.g. `ciphertext`
 * alongside `deletedAt`), fields from neither shape, or an incomplete
 * version of either shape is rejected as malformed — never guessed at,
 * never treated as a partially-trusted hybrid. An extra identity-shaped
 * field unrelated to either shape (e.g. `email`, `displayName`) has no
 * effect on acceptance.
 */
export function isValidForumReply(data: unknown): data is ForumReplyRecord {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }

  const record = data as Record<string, unknown>;

  const hasTombstoneOnlyField = TOMBSTONE_ONLY_FIELDS.some((field) => field in record);
  const hasActiveOnlyField = ACTIVE_ONLY_FIELDS.some((field) => field in record);

  if (hasTombstoneOnlyField && hasActiveOnlyField) {
    return false;
  }

  if (hasTombstoneOnlyField) {
    return isValidTombstoneShape(record);
  }

  if (hasActiveOnlyField) {
    return isValidActiveShape(record);
  }

  return false;
}

/**
 * Derives whether a reply has been tombstoned (docs/features/team-forum/
 * SPEC.md — `isForumReplyDeleted(record) = record.deletedAt is set`). Takes
 * an already-validated `ForumReplyRecord`, mirroring
 * `effectiveChallengeStatus`'s "one function, reused everywhere" derivation
 * convention — callers must run `isValidForumReply` first.
 */
export function isForumReplyDeleted(
  record: ForumReplyRecord,
): record is TombstonedForumReply {
  return "deletedAt" in record;
}

function isValidActiveShape(record: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(record.teamId) &&
    isNonEmptyString(record.threadId) &&
    isNonEmptyString(record.authorUid) &&
    isNonEmptyString(record.ciphertext) &&
    isNonEmptyString(record.iv) &&
    isNonEmptyString(record.authTag) &&
    record.keyVersion === FORUM_REPLY_KEY_VERSION &&
    isValidDate(record.createdAt)
  );
}

function isValidTombstoneShape(record: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(record.teamId) &&
    isNonEmptyString(record.threadId) &&
    isValidDate(record.createdAt) &&
    isValidDate(record.deletedAt) &&
    isNonEmptyString(record.deletedBy)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
