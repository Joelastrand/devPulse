/**
 * Pure domain rules for the Firebase-backed superadmin registry (docs/SECURITY.md, superadmin section).
 *
 * Storage shape (Admin SDK only; `firestore.rules` denies all client access):
 * - `superadmins/{uid}`: one record per Firebase Auth UID. `active` is the authority; a revoked record is kept
 *   (`active: false`) so the revocation stays auditable and the document id stays stable.
 * - `superadminRegistry/control`: a single serialization point holding `activeCount`, the number of `active: true`
 *   records. Every grant and revoke reads it and writes it in the same transaction, so two concurrent revocations
 *   conflict on this document and one of them retries against the updated count. No decision ever counts records
 *   in a separate transaction.
 *
 * No email address is stored or used as an authorization key. The UID is the only identity key.
 */

export const SUPERADMIN_COLLECTION = "superadmins";
export const SUPERADMIN_CONTROL_COLLECTION = "superadminRegistry";
export const SUPERADMIN_CONTROL_DOC_ID = "control";

export interface SuperadminRecord {
  readonly uid: string;
  readonly active: boolean;
}

/** Validates a raw registry document read from Firestore. Anything malformed is not a superadmin. */
export function parseSuperadminRecord(raw: unknown, docId: string): SuperadminRecord | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { uid, active } = raw as { uid?: unknown; active?: unknown };
  if (typeof uid !== "string" || uid !== docId || typeof active !== "boolean") return undefined;
  return { uid, active };
}

/** The active count from the control document. A missing control document means no superadmin has ever been granted. */
export function parseActiveCount(raw: unknown): number | undefined {
  if (raw === undefined) return 0;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { activeCount } = raw as { activeCount?: unknown };
  if (typeof activeCount !== "number" || !Number.isSafeInteger(activeCount) || activeCount < 0) return undefined;
  return activeCount;
}

export function isActiveSuperadmin(record: SuperadminRecord | undefined): boolean {
  return record?.active === true;
}

export type SuperadminRefusal =
  | "forbidden"
  | "not_superadmin"
  | "last_superadmin"
  | "already_superadmin_bootstrap_refused";

export type GrantDecision =
  | { readonly ok: true; readonly outcome: "granted" | "already_superadmin" }
  | { readonly ok: false; readonly error: SuperadminRefusal };

export type RevokeDecision =
  | { readonly ok: true; readonly outcome: "revoked" }
  | { readonly ok: false; readonly error: SuperadminRefusal };

export interface GrantInput {
  readonly actorUid: string;
  readonly targetUid: string;
  /** Registry state read inside the same transaction as the write. */
  readonly actor: SuperadminRecord | undefined;
  readonly target: SuperadminRecord | undefined;
}

/**
 * Only an active superadmin may grant. Granting an already-active target is an idempotent success with no write.
 * Self-promotion is refused even if a record is inconsistent: the caller must already be an active superadmin, and
 * the target of a self-grant must be that same active record.
 */
export function decideGrant(input: GrantInput): GrantDecision {
  if (!isActiveSuperadmin(input.actor)) {
    return { ok: false, error: "forbidden" };
  }
  if (input.actorUid === input.targetUid && !isActiveSuperadmin(input.target)) {
    return { ok: false, error: "forbidden" };
  }
  if (isActiveSuperadmin(input.target)) {
    return { ok: true, outcome: "already_superadmin" };
  }
  return { ok: true, outcome: "granted" };
}

export interface RevokeInput {
  readonly actorUid: string;
  readonly targetUid: string;
  readonly actor: SuperadminRecord | undefined;
  readonly target: SuperadminRecord | undefined;
  /** `activeCount` read inside the same transaction. */
  readonly activeCount: number;
}

/**
 * Only an active superadmin may revoke. A target that is not an active superadmin cannot be revoked (no silent
 * success, so the UI can show it). Revoking the last active superadmin is refused, whoever asks, so the registry
 * cannot lock itself out. Self-revocation is allowed when at least one other active superadmin remains.
 */
export function decideRevoke(input: RevokeInput): RevokeDecision {
  if (!isActiveSuperadmin(input.actor)) {
    return { ok: false, error: "forbidden" };
  }
  if (!isActiveSuperadmin(input.target)) {
    return { ok: false, error: "not_superadmin" };
  }
  if (input.activeCount <= 1) {
    return { ok: false, error: "last_superadmin" };
  }
  return { ok: true, outcome: "revoked" };
}

/** The `activeCount` after a successful transition. Callers must only apply it after a decision that changed state. */
export function activeCountAfterGrant(activeCount: number): number {
  return activeCount + 1;
}

export function activeCountAfterRevoke(activeCount: number): number {
  return activeCount - 1;
}
