/**
 * A conversation id is a Firestore auto id used as a single path segment (SPEC AD-3). The grammar is ASCII
 * only. `.` and `/` are excluded by the pattern. The SPEC also forbids `__` anywhere in the id (AD-3 says
 * "no `.`, `/` or `__`"), which is checked separately below.
 */
export const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * True only for a string that is safe to use as a single Firestore document id segment (AD-3). Validates
 * without mutating: an id is never trimmed, normalised or repaired into a valid one.
 */
export function isConversationId(value: unknown): value is string {
  return typeof value === "string" && CONVERSATION_ID_PATTERN.test(value) && !value.includes("__");
}
