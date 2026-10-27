import { hasExactKeys, isNonEmptyString, isPlainObject, isStoredDate } from "./stored-shape";

/**
 * Stored participation index entry (SPEC BR-10, BR-34, CL-13): a locator document in the D2 participant index, keyed by
 * participant uid and conversation id. This is an internal D2 persistence shape only. It grants no access to personal-goal storage.
 * It is a locator only. It holds the owner uid and the invitation time, never content, and it grants nothing alone:
 * access is re-derived from the owner document (BR-21). The conversation id is the document path, not a field.
 */
export const PARTICIPATION_INDEX_KEYS = ["ownerUid", "invitedAt"] as const;

export type StoredParticipationIndex = {
  ownerUid: string;
  invitedAt: Date;
};

export type ParseStoredParticipationIndexResult = { ok: true; entry: StoredParticipationIndex } | { ok: false };

/**
 * Validates one index entry. Any other field, a non-string owner uid, or an invalid instant makes the entry invalid.
 * Callers omit an invalid entry without a placeholder (BR-34).
 */
export function parseStoredParticipationIndex(data: unknown): ParseStoredParticipationIndexResult {
  if (!isPlainObject(data) || !hasExactKeys(data, PARTICIPATION_INDEX_KEYS)) {
    return { ok: false };
  }
  const { ownerUid, invitedAt } = data;
  if (!isNonEmptyString(ownerUid) || !isStoredDate(invitedAt)) {
    return { ok: false };
  }
  return { ok: true, entry: { ownerUid, invitedAt } };
}
