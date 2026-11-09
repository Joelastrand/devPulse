import "server-only";
import { issueErasureResumeCapability } from "../../auth/server/erasure-resume-capability";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { isRecentAuth } from "../../auth/server/recent-auth";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { normalizeEmail } from "../../teams/domain/normalize-email";
import { RECENT_AUTH_WINDOW_SECONDS } from "../domain/erasure-constants";
import type { ErasureStep } from "../domain/erasure-state";
import { readErasureRecord } from "./erasure-store";
import { getDefaultErasureStartPort, startErasureAtomically, type ErasureStartPort } from "./erasure-start-atomic";
import { runErasure, type RunBudget, type StepHandler } from "./erasure-runner";
import { runAuthDeletion, type AuthDeletionPort } from "./auth-deletion";
import type { ErasureStorePort } from "./erasure-store-types";

/**
 * `POST /api/me/erasure` operation: start or resume one erasure (TASK-013, SPEC "Start/resume contract").
 *
 * - no record: start, after recent authentication and a confirmation that matches the verified email; the record is
 *   created in one transaction, then the runner runs;
 * - `in_progress` (including a resumable failed step): resume from the stored step; no fresh sign-in and no confirmation;
 * - `completed`: the operation returns the terminal result and never restarts;
 * - `auth_deleted` or a malformed/unreadable record: fail closed (`erasure_unavailable`), never start.
 *
 * Production readiness is checked before any record is created and before any runner step. While it is not ready, the
 * operation refuses with `erasure_unavailable` and writes nothing, so a user cannot be left with a fence and no way to
 * progress (see production-erasure.ts).
 *
 * The verified uid comes only from the token. This operation is the only caller of the fence bypass `allowDuringErasure`.
 */

export type StartErasureState = { status: "in_progress"; step: ErasureStep } | { status: "completed" };

export type StartErasureError =
  | AuthRefusal
  | "recent_auth_required"
  | "confirmation_mismatch"
  | "erasure_unavailable"
  | "last_superadmin";

export type StartErasureResult = { ok: true; state: StartErasureState } | { ok: false; error: StartErasureError };

/** The verified identity of one start/resume request. `normalizedEmail` is non-empty (see `toErasureRequest`). */
export interface ErasureRequest {
  readonly uid: string;
  readonly normalizedEmail: string;
}

export interface StartErasureDeps {
  readonly port: ErasureStorePort;
  readonly handlers: Partial<Record<ErasureStep, StepHandler>>;
  /** Monotonic millisecond clock for the per-request wall budget. */
  readonly clockMs: () => number;
  readonly now: () => Date;
  /** Unix time in seconds, for the recent-authentication check. */
  readonly nowSeconds: () => number;
  /** Production readiness. `false` refuses every path that would run the runner or create a record. */
  readonly ready: boolean;
  readonly budget?: RunBudget;
  /**
   * Production handler graph for this request (TASK-038). When set, it replaces `handlers`. It is built from the verified
   * identity only, so the normalized e-mail used for invitation matching never comes from request input.
   */
  readonly handlersFor?: (request: ErasureRequest) => Partial<Record<ErasureStep, StepHandler>>;
  /**
   * Production Auth deletion and final sweep for this request (TASK-038). Used after the runner hands off at `auth_delete`.
   * Without it, the handoff returns the `auth_delete` state, as before the production wiring.
   */
  readonly authDeletion?: (request: ErasureRequest) => {
    readonly auth: AuthDeletionPort;
    readonly finalSweep: (uid: string) => Promise<boolean>;
  };
  readonly verifyToken?: VerifyIdTokenDeps["verifyToken"];
  readonly readFence?: VerifyIdTokenDeps["readFence"];
  /**
   * Owner decision (Option A): the start creates the fence and revokes this uid's superadmin privilege in ONE transaction,
   * and refuses the last active superadmin. Defaults to the production Firestore transaction; tests inject the fake store.
   */
  readonly startPort?: ErasureStartPort;
}

export interface StartErasureInput {
  /** Required to start; not needed to resume. The HTTP layer has already checked that it is a string when present. */
  readonly confirmation?: string;
}

const UNAVAILABLE: StartErasureResult = { ok: false, error: "erasure_unavailable" };

/**
 * The per-request identity for the handler graph. An empty normalized e-mail returns undefined, and the caller fails closed
 * before any step runs, so no invitation cleanup can run with an unverified or missing address (approved decision).
 */
/**
 * The erasure request needs the trusted, verified e-mail (SPEC BR-2). An unverified claim is never used to match invitations,
 * so it yields no request, and the caller fails closed before any record or step.
 */
function toErasureRequest(uid: string, email: string, emailVerified: boolean): ErasureRequest | undefined {
  if (!emailVerified) return undefined;
  const normalizedEmail = normalizeEmail(email);
  return normalizedEmail.length === 0 ? undefined : { uid, normalizedEmail };
}

export async function startOrResumeErasure(
  idToken: string,
  input: StartErasureInput,
  deps: StartErasureDeps,
): Promise<StartErasureResult> {
  // The erasure endpoint is the only caller allowed through the in-progress fence (SPEC "Start/resume contract").
  const verified = await verifyIdToken(idToken, {
    verifyToken: deps.verifyToken,
    readFence: deps.readFence,
    allowDuringErasure: issueErasureResumeCapability(),
  });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };

  const { uid, email, emailVerified, verifiedAuthTime } = verified.identity;

  const existing = await readErasureRecord(deps.port, uid);
  if (!existing.ok && existing.error !== "not_found") return UNAVAILABLE;

  if (existing.ok) {
    if (existing.value.status === "completed") return { ok: true, state: { status: "completed" } };
    if (existing.value.status !== "in_progress") return UNAVAILABLE;
    if (!deps.ready) return UNAVAILABLE;
    const request = toErasureRequest(uid, email, emailVerified);
    if (request === undefined) return UNAVAILABLE;
    return runAndReport(deps, request);
  }

  if (!isRecentAuth(verifiedAuthTime, deps.nowSeconds(), RECENT_AUTH_WINDOW_SECONDS)) {
    return { ok: false, error: "recent_auth_required" };
  }
  if (input.confirmation === undefined || normalizeEmail(input.confirmation) !== normalizeEmail(email)) {
    return { ok: false, error: "confirmation_mismatch" };
  }

  // Readiness is checked before the record exists, so a refused start creates no fence.
  if (!deps.ready) return UNAVAILABLE;
  const request = toErasureRequest(uid, email, emailVerified);
  if (request === undefined) return UNAVAILABLE;

  // Fence and superadmin revoke commit together or not at all (erasure-start-atomic.ts), so a failed fence never leaves
  // the person demoted.
  const started = await startErasureAtomically(deps.startPort ?? getDefaultErasureStartPort(), uid, deps.now());
  if (!started.ok) return started.error === "last_superadmin" ? { ok: false, error: "last_superadmin" } : UNAVAILABLE;
  if (started.record.status === "completed") return { ok: true, state: { status: "completed" } };

  return runAndReport(deps, request);
}

async function runAndReport(deps: StartErasureDeps, request: ErasureRequest): Promise<StartErasureResult> {
  const outcome = await runErasure(
    {
      port: deps.port,
      handlers: deps.handlersFor ? deps.handlersFor(request) : deps.handlers,
      clockMs: deps.clockMs,
      now: deps.now,
      budget: deps.budget,
    },
    request.uid,
  );

  switch (outcome.status) {
    case "in_progress":
      return { ok: true, state: { status: "in_progress", step: outcome.step } };
    case "handoff":
      if (deps.authDeletion === undefined) return { ok: true, state: { status: "in_progress", step: outcome.step } };
      return completeAfterHandoff(deps, request, deps.authDeletion(request));
    case "failed":
    case "store_error":
    case "not_running":
      // The persisted code and any detail stay internal (SPEC BR-15). The state remains resumable.
      return UNAVAILABLE;
  }
}

/**
 * Auth deletion and the final sweep, after the runner's handoff at `auth_delete` (TASK-037). The first call deletes Auth and
 * marks `auth_deleted`; the second advances to `final_sweep` and completes only when the sweep finds zero matches. Any other
 * outcome is the resumable unavailable response, with no detail.
 */
async function completeAfterHandoff(
  deps: StartErasureDeps,
  request: ErasureRequest,
  chain: { readonly auth: AuthDeletionPort; readonly finalSweep: (uid: string) => Promise<boolean> },
): Promise<StartErasureResult> {
  const ports = { port: deps.port, auth: chain.auth, finalSweep: chain.finalSweep, now: deps.now };
  let outcome = await runAuthDeletion(ports, request.uid);
  if (outcome.status === "auth_deleted") outcome = await runAuthDeletion(ports, request.uid);
  if (outcome.status === "completed") return { ok: true, state: { status: "completed" } };
  return UNAVAILABLE;
}
