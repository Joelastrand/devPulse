import "server-only";
import { eraseSuperadminRecord, type SuperadminErasureDeps } from "../../superadmins/server/superadmin-erasure";
import { ErasureStepFailure, type BatchResult, type StepHandler } from "./erasure-runner";

/**
 * The `personal_data` cleanup for the superadmin registry (I-16). The erased person's `superadmins/{uid}` record is deleted
 * and the registry count is kept exact (owner decision, account erasure Option A). It runs after the start revoke, and it is
 * idempotent: an absent record is `done`. A refusal or infrastructure failure stays resumable, and no detail is stored.
 */
export function createSuperadminRecordStepHandler(deps: SuperadminErasureDeps = {}): StepHandler {
  return {
    async runBatch({ uid, maxWrites }): Promise<BatchResult> {
      // A zero budget could report "done" with a record still present, so it is a programming error (as in actor_audit).
      if (maxWrites < 1) throw new ErasureStepFailure("unexpected");
      const result = await eraseSuperadminRecord(uid, deps);
      if (result.ok) return "done";
      throw new ErasureStepFailure(result.error === "last_superadmin" ? "verification_failed" : "store_unavailable");
    },
  };
}
