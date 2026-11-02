import "server-only";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { StartErasureDeps } from "./start-erasure";
import { getDefaultErasureStorePort } from "./erasure-store";
import { createAdminAuthDeletionPort } from "./auth-deletion-adapter";
import { buildProductionStepHandlers } from "./production-erasure-handlers";
import { createSweepCounter } from "./erasure-adapters-sweep";
import { runVerificationSweep } from "./verification-sweep";

/**
 * Production readiness gate for `POST /api/me/erasure` (TASK-013, approved option 1; TASK-038).
 *
 * `true` only when the complete production handler chain is wired: every port-based step handler, the verify_data residual
 * handler with its cleanups, and the Auth deletion and final sweep. While it is `false`, the endpoint refuses with
 * `erasure_unavailable` before any record is created, before any fence is active, and before any runner step.
 *
 * TASK-038 sets this to `true` in the same reviewed change that wires the chain below (see the TASK-038 review record).
 */
export const PRODUCTION_HANDLERS_READY = true;

export interface ProductionStartErasureOverrides {
  readonly port?: StartErasureDeps["port"];
  readonly verifyToken?: VerifyIdTokenDeps["verifyToken"];
  readonly readFence?: VerifyIdTokenDeps["readFence"];
}

/**
 * Production dependencies for the start/resume operation. The handler graph and the Auth step are built per request from the
 * verified identity, so the normalized e-mail for invitation matching and the final sweep comes only from that request.
 */
export function getProductionStartErasureDeps(overrides: ProductionStartErasureOverrides = {}): StartErasureDeps {
  return {
    port: overrides.port ?? getDefaultErasureStorePort(),
    handlers: {},
    handlersFor: (request) =>
      buildProductionStepHandlers({ uid: request.uid, normalizedEmail: request.normalizedEmail }, () => new Date()),
    authDeletion: (request) => ({
      auth: createAdminAuthDeletionPort(),
      finalSweep: (uid) => finalSweepIsClean(uid, request.normalizedEmail),
    }),
    clockMs: () => performance.now(),
    now: () => new Date(),
    nowSeconds: () => Math.floor(Date.now() / 1000),
    ready: PRODUCTION_HANDLERS_READY,
    verifyToken: overrides.verifyToken,
    readFence: overrides.readFence,
  };
}

/** The final sweep after Auth deletion: zero residual matches for the inventory, with the verified normalized e-mail. */
async function finalSweepIsClean(uid: string, normalizedEmail: string): Promise<boolean> {
  const report = await runVerificationSweep(createSweepCounter(), { uid, normalizedEmail });
  return report.complete;
}
