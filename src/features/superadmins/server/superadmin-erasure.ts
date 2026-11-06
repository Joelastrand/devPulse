import "server-only";
import { decideRevoke, activeCountAfterRevoke, isActiveSuperadmin, parseActiveCount, parseSuperadminRecord } from "../domain/superadmin-registry";
import { getDefaultSuperadminStore, type SuperadminStore, type SuperadminTransaction } from "./superadmin-store";

/**
 * Owner decision (account erasure, Option A): an erased account's superadmin privilege is removed by the erasure workflow.
 *
 * - Start of erasure (`revokeSuperadminForErasureStart`): an active superadmin is revoked before the erasure fence is
 *   created. When the account is the last active superadmin, the start is refused with `last_superadmin` and no fence is
 *   created. The last-superadmin check runs against `superadminRegistry/control` in the same transaction as the revoke,
 *   so two concurrent erasures of two superadmins cannot both remove the last one.
 * - Erasure step (`eraseSuperadminRecord`): the erased person's registry record is deleted, and the control count is kept
 *   exact. It runs without the erasure fence, because the fence exists by then.
 *
 * No recovery path promotes anyone to superadmin here. Re-appointing a superadmin is a separate, explicit grant.
 */

export type SuperadminErasureRefusal = "last_superadmin" | "unavailable";

export type RevokeForErasureStartResult = { readonly ok: true } | { readonly ok: false; readonly error: SuperadminErasureRefusal };

export interface SuperadminErasureDeps {
  readonly store?: SuperadminStore;
  readonly now?: Date;
}

/** Decides and applies the revoke for an account that is starting erasure. Not an active superadmin is `ok` with no write. */
export async function revokeSuperadminForErasureStart(
  uid: string,
  deps: SuperadminErasureDeps = {},
): Promise<RevokeForErasureStartResult> {
  const store = deps.store ?? getDefaultSuperadminStore();
  const now = deps.now ?? new Date();
  try {
    return await store.run({ actorUid: uid, targetUid: uid }, async (tx: SuperadminTransaction): Promise<RevokeForErasureStartResult> => {
      const record = parseSuperadminRecord(await tx.readRecord(uid), uid);
      if (!isActiveSuperadmin(record)) return { ok: true };

      const activeCount = parseActiveCount(await tx.readActiveCount());
      if (activeCount === undefined) return { ok: false, error: "unavailable" };

      const decision = decideRevoke({ actorUid: uid, targetUid: uid, actor: record, target: record, activeCount });
      if (!decision.ok) {
        return { ok: false, error: decision.error === "last_superadmin" ? "last_superadmin" : "unavailable" };
      }
      tx.mergeRecord(uid, { active: false, revokedAt: now, revokedByUid: uid, updatedAt: now });
      tx.writeActiveCount(activeCountAfterRevoke(activeCount), now);
      return { ok: true };
    });
  } catch {
    // No fence exists yet at start, so a failure here is an infrastructure failure: unavailable and resumable.
    return { ok: false, error: "unavailable" };
  }
}

export type EraseSuperadminRecordResult = { readonly ok: true } | { readonly ok: false; readonly error: SuperadminErasureRefusal };

/**
 * Deletes the erased person's registry record. An absent record is `ok`. A record still active at this point (for example
 * one granted after the start revoke, which the fence forbids) is revoked through the same count rule before it is deleted;
 * if that revoke would remove the last superadmin, the step fails and the erasure stays resumable.
 */
export async function eraseSuperadminRecord(uid: string, deps: SuperadminErasureDeps = {}): Promise<EraseSuperadminRecordResult> {
  const store = deps.store ?? getDefaultSuperadminStore();
  try {
    return await store.runUnfenced(async (tx: SuperadminTransaction): Promise<EraseSuperadminRecordResult> => {
      const raw = await tx.readRecord(uid);
      if (raw === undefined) return { ok: true };

      const record = parseSuperadminRecord(raw, uid);
      if (isActiveSuperadmin(record)) {
        const activeCount = parseActiveCount(await tx.readActiveCount());
        if (activeCount === undefined) return { ok: false, error: "unavailable" };
        const decision = decideRevoke({ actorUid: uid, targetUid: uid, actor: record, target: record, activeCount });
        if (!decision.ok) {
          return { ok: false, error: decision.error === "last_superadmin" ? "last_superadmin" : "unavailable" };
        }
        tx.writeActiveCount(activeCountAfterRevoke(activeCount), deps.now ?? new Date());
      }
      tx.deleteRecord(uid);
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
