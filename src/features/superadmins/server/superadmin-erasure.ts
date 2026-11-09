import "server-only";
import { decideRevoke, activeCountAfterRevoke, isActiveSuperadmin, parseActiveCount, parseSuperadminRecord } from "../domain/superadmin-registry";
import { getDefaultSuperadminStore, type SuperadminStore, type SuperadminTransaction } from "./superadmin-store";

/**
 * Owner decision (account erasure, Option A): an erased account's superadmin privilege is removed by the erasure workflow.
 *
 * - Start of erasure: NOT here. `startErasureAtomically` (account-erasure/server/erasure-start-atomic.ts) revokes the
 *   privilege and creates the fence in one transaction, and refuses the last active superadmin with `last_superadmin`.
 *   The revoke therefore never commits without its fence.
 * - Erasure step (`eraseSuperadminRecord`): the erased person's registry record is deleted, and the control count is kept
 *   exact. It runs without the erasure fence, because the fence exists by then.
 *
 * No recovery path promotes anyone to superadmin here. Re-appointing a superadmin is a separate, explicit grant.
 */

export type SuperadminErasureRefusal = "last_superadmin" | "unavailable";

export interface SuperadminErasureDeps {
  readonly store?: SuperadminStore;
  readonly now?: Date;
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
