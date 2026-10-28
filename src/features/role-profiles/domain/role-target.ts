/** Stored shape of the owner's single target document (AD-2): exactly these two keys, no history. */
export interface StoredRoleTarget {
  roleId: string;
  updatedAt: Date;
}

export type ParseStoredRoleTargetResult = { ok: true; target: StoredRoleTarget } | { ok: false };

/** The owner-facing target status (PG-3). Carries no stored content when it is not `selected`. */
export type RoleTargetStatus =
  | { status: "none" }
  | { status: "unavailable" }
  | { status: "selected"; target: { roleId: string; name: string; archived: boolean } };

const STORED_KEYS: ReadonlySet<string> = new Set(["roleId", "updatedAt"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Validates untrusted stored target content before it is used. Any extra key, a non-string or empty `roleId`, or a
 * non-Date `updatedAt` makes the document malformed (BR-20). The caller reports malformed content as `unavailable`
 * without echoing any of it.
 */
export function parseStoredRoleTarget(data: unknown): ParseStoredRoleTargetResult {
  if (!isRecord(data) || Object.keys(data).some((key) => !STORED_KEYS.has(key))) {
    return { ok: false };
  }
  const { roleId, updatedAt } = data;
  if (typeof roleId !== "string" || roleId.length === 0 || !isValidDate(updatedAt)) {
    return { ok: false };
  }
  return { ok: true, target: { roleId, updatedAt } };
}
