/**
 * The erased-thread placeholder (docs/features/account-erasure/SPEC.md — "Erased-thread placeholder shape", TASK-014).
 * Only the account-erasure forum step creates this shape. It is deliberately distinct from `ForumThreadRecord`: it has
 * no title, body, ciphertext, `authorUid`, or `authorTag`, so no active-thread reader can accept it by accident.
 *
 * Added beside the existing thread predicates. `isValidForumThread` still rejects a placeholder, and since TASK-015 it also
 * rejects any record that carries `status` or `erasedAt`, even one with every active field present (fail closed).
 */

/** The `status` value of an erased-thread placeholder. */
export const ERASED_THREAD_STATUS = "erased" as const;

export interface ErasedForumThreadRecord {
  teamId: string;
  createdAt: Date;
  erasedAt: Date;
  status: typeof ERASED_THREAD_STATUS;
}

/**
 * Fail-closed validator for an erased-thread placeholder. Accepts only the exact shape: `teamId`, `createdAt`, `erasedAt`,
 * `status: "erased"`, and nothing else. Never throws.
 */
export function isErasedForumThread(data: unknown): data is ErasedForumThreadRecord {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;

  const record = data as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowed = ["teamId", "createdAt", "erasedAt", "status"];
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) return false;

  return (
    typeof record.teamId === "string" &&
    record.teamId.trim().length > 0 &&
    isValidDate(record.createdAt) &&
    isValidDate(record.erasedAt) &&
    record.status === ERASED_THREAD_STATUS
  );
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
