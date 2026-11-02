import type { ErasureStep } from "../domain/erasure-state";
import { advanceErasureStep, completeErasure, markErasureAuthDeleted, readErasureRecord, recordErasureError } from "./erasure-store";
import type { ErasureStorePort, StoreError } from "./erasure-store-types";

/**
 * Auth deletion and completion (TASK-037, BR-6, BR-17, AE-SI-4).
 *
 * Runs after the runner hands off at `auth_delete`, which is reached only after `verify_data` returned zero (ordering is
 * enforced by the record: this module acts only at `auth_delete` or `final_sweep`).
 *
 * - `auth_delete`: deletes the Auth user through an injected port. `not_found` (already absent) counts as success, so a
 *   retry is safe. A transient failure stores `auth_unavailable` and leaves the step at `auth_delete`.
 * - `auth_deleted`: status is set after the Auth user is confirmed absent.
 * - `final_sweep`: the injected sweep re-runs the inventory queries. Zero matches completes the erasure with `completedAt`
 *   and `expireAt`; any match stores `verification_failed` and the record stays `auth_deleted`.
 */

/** `not_found` means the Auth user is already absent (`auth/user-not-found`). Only `deleted` or `not_found` count as absent. */
export type AuthDeleteResult = "deleted" | "not_found" | "unavailable";

export interface AuthDeletionPort {
  deleteUser(uid: string): Promise<AuthDeleteResult>;
}

export interface AuthDeletionDeps {
  readonly port: ErasureStorePort;
  readonly auth: AuthDeletionPort;
  /**
   * Re-runs the inventory queries after Auth deletion. Resolves `true` only for zero matches. The wiring must supply the
   * normalized email for invitation matching, and must resolve `false` (fail closed) when that email is unavailable.
   */
  readonly finalSweep: (uid: string) => Promise<boolean>;
  readonly now: () => Date;
}

export type AuthDeletionOutcome =
  | { status: "auth_deleted" }
  | { status: "completed" }
  | { status: "failed"; step: ErasureStep; errorCode: "auth_unavailable" | "verification_failed" }
  | { status: "not_running" }
  | { status: "store_error"; error: StoreError };

export async function runAuthDeletion(deps: AuthDeletionDeps, uid: string): Promise<AuthDeletionOutcome> {
  const current = await readErasureRecord(deps.port, uid);
  if (!current.ok) {
    return current.error === "not_found" ? { status: "not_running" } : { status: "store_error", error: current.error };
  }
  const { status, step } = current.value;

  if (status === "in_progress" && step === "auth_delete") return deleteAuthThenMark(deps, uid);
  if (status === "auth_deleted" && step === "auth_delete") {
    // The Auth deletion and its status write already happened. Move to `final_sweep` before sweeping.
    const advanced = await advanceErasureStep(deps.port, uid, "final_sweep", deps.now());
    if (!advanced.ok) return { status: "store_error", error: advanced.error };
    return finalSweepAndComplete(deps, uid);
  }
  if (status === "auth_deleted" && step === "final_sweep") return finalSweepAndComplete(deps, uid);
  // Any other state (for example `verify_data` or an earlier step) is not this module's to act on.
  return { status: "not_running" };
}

async function deleteAuthThenMark(deps: AuthDeletionDeps, uid: string): Promise<AuthDeletionOutcome> {
  const deleted = await deps.auth.deleteUser(uid);
  if (deleted === "unavailable") {
    const recorded = await recordErasureError(deps.port, uid, "auth_unavailable", deps.now());
    if (!recorded.ok) return { status: "store_error", error: recorded.error };
    return { status: "failed", step: "auth_delete", errorCode: "auth_unavailable" };
  }
  // Auth is confirmed absent (`deleted` or `not_found`). If this status write fails, the record stays `in_progress/auth_delete`;
  // a retry then reads `not_found` and marks it again (SPEC "Partial failure" table).
  const marked = await markErasureAuthDeleted(deps.port, uid, deps.now());
  if (!marked.ok) return { status: "store_error", error: marked.error };
  return { status: "auth_deleted" };
}

async function finalSweepAndComplete(deps: AuthDeletionDeps, uid: string): Promise<AuthDeletionOutcome> {
  // A failure while counting residuals is operational. It is reported as a store error, so the start path answers with the
  // fixed unavailable response and no detail (AE-SI-2, AE-SI-12). The record stays where the state machine left it.
  let clean: boolean;
  try {
    clean = await deps.finalSweep(uid);
  } catch {
    return { status: "store_error", error: "store_unavailable" };
  }
  if (!clean) {
    const recorded = await recordErasureError(deps.port, uid, "verification_failed", deps.now());
    if (!recorded.ok) return { status: "store_error", error: recorded.error };
    return { status: "failed", step: "final_sweep", errorCode: "verification_failed" };
  }
  const completed = await completeErasure(deps.port, uid, deps.now());
  if (!completed.ok) return { status: "store_error", error: completed.error };
  return { status: "completed" };
}
