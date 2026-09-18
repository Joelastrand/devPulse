/**
 * The exact key-version literal `src/lib/encryption/encryption.ts` ever
 * produces. Declared independently here (not imported from that module) so
 * this domain module stays framework/I-O free (docs/features/team-forum/
 * SPEC.md — "Data model").
 */
export type ForumThreadKeyVersion = "v1";

const FORUM_THREAD_KEY_VERSION: ForumThreadKeyVersion = "v1";

/**
 * The canonical, persisted `forumThreads/{threadId}` document shape
 * (docs/features/team-forum/SPEC.md — "Data model"). `threadId` itself is
 * the Firestore document id, never a field on this record.
 *
 * A thread has no tombstone shape at all — it either exists (this shape) or
 * it does not exist as a document (deleted). There is deliberately no
 * `deletedAt`/`deletedBy` field anywhere on this type (Owner Decision 2);
 * `isValidForumThread` treats either field's presence as malformed, not as
 * an optional extra.
 */
export interface ForumThreadRecord {
  teamId: string;
  authorUid: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: ForumThreadKeyVersion;
  createdAt: Date;
}

/**
 * Fail-closed runtime validator for a candidate `forumThreads` document —
 * the guard every later Firestore-reading task must go through before
 * treating raw document data as a `ForumThreadRecord` (`.claude/rules/
 * typescript.md`). Never throws.
 *
 * Rejects: a missing/non-object candidate; a missing/blank/wrong-typed
 * `teamId`, `authorUid`, `ciphertext`, `iv`, or `authTag`; a `keyVersion`
 * that isn't the exact literal `"v1"`; a missing/invalid `createdAt`; and —
 * unlike this codebase's general "extra fields are tolerated" convention —
 * a candidate carrying a `deletedAt` or `deletedBy` field of any kind. A
 * thread schema has no such fields at all (docs/features/team-forum/
 * SPEC.md — "Data model", "Lifecycle/moderation"), so their mere presence
 * is itself a malformed-shape rejection, never silently ignored.
 */
export function isValidForumThread(data: unknown): data is ForumThreadRecord {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }

  const record = data as Record<string, unknown>;

  if ("deletedAt" in record || "deletedBy" in record) {
    return false;
  }

  return (
    isNonEmptyString(record.teamId) &&
    isNonEmptyString(record.authorUid) &&
    isNonEmptyString(record.ciphertext) &&
    isNonEmptyString(record.iv) &&
    isNonEmptyString(record.authTag) &&
    record.keyVersion === FORUM_THREAD_KEY_VERSION &&
    isValidDate(record.createdAt)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
