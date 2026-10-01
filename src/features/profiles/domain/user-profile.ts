import { normalizeDisplayName } from "./display-name";

/**
 * The canonical, persisted `userProfiles/{uid}` document shape (docs/
 * features/member-identity-and-team-roles/SPEC.md — "Architecture
 * decisions"). The Firebase `uid` is the document id and is deliberately not
 * a stored field; nothing else (e-mail, role, free text) belongs here.
 */
export interface UserProfileRecord {
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Fail-closed runtime validator for a candidate `UserProfileRecord`
 * (callers map Firestore `Timestamp`s to `Date`s first). The stored name must
 * already be in its canonical normalised form, so a hand-edited or
 * otherwise non-canonical document reads as absent rather than being
 * partially trusted. Never throws.
 */
export function isValidUserProfile(data: unknown): data is UserProfileRecord {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }

  const record = data as Record<string, unknown>;
  const name = normalizeDisplayName(record.displayName);
  return (
    name.ok &&
    name.displayName === record.displayName &&
    isValidDate(record.createdAt) &&
    isValidDate(record.updatedAt)
  );
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
