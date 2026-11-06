import "server-only";
import { getAdminAuth } from "../../../lib/firebase/admin";
import { type AuthRefusal } from "../../auth/server/auth-refusal";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { normalizeEmail } from "../../teams/domain/normalize-email";
import { type IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import {
  activeCountAfterGrant,
  activeCountAfterRevoke,
  decideGrant,
  decideRevoke,
  parseActiveCount,
  parseSuperadminRecord,
  type SuperadminRefusal,
} from "../domain/superadmin-registry";
import { getDefaultSuperadminStore, type SuperadminStore } from "./superadmin-store";

/**
 * Superadmin registry operations. Every operation authenticates the caller with `requireAppAdmin` (verified token,
 * revocation-checked, verified email, and an active registry record read on this request), then makes its decision
 * inside one Firestore transaction. The caller's registry state is therefore re-read at the point of the write, so a
 * revocation that lands first makes the later request fail with `forbidden`.
 */

export type SuperadminOperationError =
  | AuthRefusal
  | SuperadminRefusal
  | "invalid_input"
  | "target_not_found"
  | "target_unverified"
  | "target_disabled"
  | "persistence_failed";

export interface SuperadminOperationDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  readFence?: VerifyIdTokenDeps["readFence"];
  /** Injected superadmin check for the caller. Defaults to the registry read through the default store. */
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  store?: SuperadminStore;
  /** Resolves an Auth user by email, for granting. Returns `undefined` when no such account exists. */
  lookupAuthUserByEmail?: (email: string) => Promise<AuthUserLookup | undefined>;
  now?: Date;
}

/** The only Auth fields the grant decision uses. Granting requires a verified, enabled account. */
export interface AuthUserLookup {
  readonly uid: string;
  readonly emailVerified: boolean;
  readonly disabled: boolean;
}

export type GrantSuperadminResult =
  | { ok: true; outcome: "granted" | "already_superadmin"; targetUid: string }
  | { ok: false; error: SuperadminOperationError };

export type RevokeSuperadminResult = { ok: true; targetUid: string } | { ok: false; error: SuperadminOperationError };

export interface SuperadminListEntry {
  readonly uid: string;
  readonly grantedAt: Date | null;
}

export type ListSuperadminsResult =
  | { ok: true; superadmins: readonly SuperadminListEntry[] }
  | { ok: false; error: SuperadminOperationError };

const MAX_EMAIL_LENGTH = 254;

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("/");
}

/** The email is a lookup input for Auth only. It is never stored and never an authorization key. */
function parseTargetEmail(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_EMAIL_LENGTH) return undefined;
  const email = normalizeEmail(value);
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1 || /\s/.test(email)) return undefined;
  return email;
}

function getDefaultAuthLookup(): (email: string) => Promise<AuthUserLookup | undefined> {
  return async (email) => {
    try {
      const user = await getAdminAuth().getUserByEmail(email);
      return { uid: user.uid, emailVerified: user.emailVerified, disabled: user.disabled };
    } catch (error) {
      if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "auth/user-not-found") {
        return undefined;
      }
      throw error;
    }
  };
}

function registryStore(deps: SuperadminOperationDeps): SuperadminStore {
  return deps.store ?? getDefaultSuperadminStore();
}

/**
 * Grants superadmin to an existing, verified, enabled Firebase Auth account identified by email. The target is resolved
 * through Firebase Auth; an unknown address is refused, and no account is ever created. The grant is recorded by UID.
 */
export async function grantSuperadmin(
  idToken: string,
  targetEmailInput: unknown,
  deps: SuperadminOperationDeps = {},
): Promise<GrantSuperadminResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, readFence: deps.readFence, isSuperadmin: deps.isSuperadmin });
  if (!admin.ok) return { ok: false, error: admin.error };

  const email = parseTargetEmail(targetEmailInput);
  if (email === undefined) return { ok: false, error: "invalid_input" };

  const lookup = deps.lookupAuthUserByEmail ?? getDefaultAuthLookup();
  let target: AuthUserLookup | undefined;
  try {
    target = await lookup(email);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
  if (target === undefined) return { ok: false, error: "target_not_found" };
  if (!target.emailVerified) return { ok: false, error: "target_unverified" };
  if (target.disabled) return { ok: false, error: "target_disabled" };

  const actorUid = admin.identity.uid;
  const targetUid = target.uid;
  const now = deps.now ?? new Date();

  try {
    const outcome = await registryStore(deps).run({ actorUid, targetUid }, async (tx) => {
      const actor = parseSuperadminRecord(await tx.readRecord(actorUid), actorUid);
      const targetRecord = parseSuperadminRecord(await tx.readRecord(targetUid), targetUid);
      const activeCount = parseActiveCount(await tx.readActiveCount());
      if (activeCount === undefined) return { ok: false, error: "persistence_failed" } as const;

      const decision = decideGrant({ actorUid, targetUid, actor, target: targetRecord });
      if (!decision.ok) return decision;
      if (decision.outcome === "granted") {
        tx.mergeRecord(targetUid, {
          uid: targetUid,
          active: true,
          grantedAt: now,
          grantedByUid: actorUid,
          revokedAt: null,
          revokedByUid: null,
          updatedAt: now,
        });
        tx.writeActiveCount(activeCountAfterGrant(activeCount), now);
      }
      return decision;
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };
    return { ok: true, outcome: outcome.outcome, targetUid };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

/**
 * Revokes an active superadmin by UID. Refused for the last active superadmin, enforced by the transaction on the
 * `superadminRegistry/control` document: concurrent revocations conflict on that document, so one retries and sees the
 * updated count.
 */
export async function revokeSuperadmin(
  idToken: string,
  targetUidInput: unknown,
  deps: SuperadminOperationDeps = {},
): Promise<RevokeSuperadminResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, readFence: deps.readFence, isSuperadmin: deps.isSuperadmin });
  if (!admin.ok) return { ok: false, error: admin.error };
  if (!isSafeId(targetUidInput)) return { ok: false, error: "invalid_input" };

  const actorUid = admin.identity.uid;
  const targetUid = targetUidInput;
  const now = deps.now ?? new Date();

  try {
    const outcome = await registryStore(deps).run({ actorUid, targetUid }, async (tx) => {
      const actor = parseSuperadminRecord(await tx.readRecord(actorUid), actorUid);
      const targetRecord = parseSuperadminRecord(await tx.readRecord(targetUid), targetUid);
      const activeCount = parseActiveCount(await tx.readActiveCount());
      if (activeCount === undefined) return { ok: false, error: "persistence_failed" } as const;

      const decision = decideRevoke({ actorUid, targetUid, actor, target: targetRecord, activeCount });
      if (!decision.ok) return decision;
      tx.mergeRecord(targetUid, {
        active: false,
        revokedAt: now,
        revokedByUid: actorUid,
        updatedAt: now,
      });
      tx.writeActiveCount(activeCountAfterRevoke(activeCount), now);
      return decision;
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };
    return { ok: true, targetUid };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

/** Lists active superadmins for a superadmin. Returns UIDs and grant times only; no contact data is stored or returned. */
export async function listSuperadmins(idToken: string, deps: SuperadminOperationDeps = {}): Promise<ListSuperadminsResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, readFence: deps.readFence, isSuperadmin: deps.isSuperadmin });
  if (!admin.ok) return { ok: false, error: admin.error };

  try {
    const rows = await registryStore(deps).listActiveRecords();
    const superadmins: SuperadminListEntry[] = [];
    for (const row of rows) {
      const record = parseSuperadminRecord(row, idDocOf(row));
      if (!record || !record.active) continue;
      superadmins.push({ uid: record.uid, grantedAt: timestampToDate((row as { grantedAt?: unknown }).grantedAt) });
    }
    superadmins.sort((a, b) => a.uid.localeCompare(b.uid));
    return { ok: true, superadmins };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/** The list rows carry the document id as `docId` (see `listActiveRecords`); a row without one is not a record. */
function idDocOf(row: unknown): string {
  if (typeof row === "object" && row !== null && typeof (row as { docId?: unknown }).docId === "string") {
    return (row as { docId: string }).docId;
  }
  return "";
}

function timestampToDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}
