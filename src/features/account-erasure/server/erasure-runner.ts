import {
  MAX_BATCHES_PER_REQUEST,
  REQUEST_WALL_BUDGET_MS,
  WRITES_PER_BATCH,
} from "../domain/erasure-constants";
import { ERASURE_STEPS, type ErasureRecordErrorCode, type ErasureStep } from "../domain/erasure-state";
import { advanceErasureStep, readErasureRecord, recordErasureError } from "./erasure-store";
import type { ErasureStorePort, StoreError } from "./erasure-store-types";

/**
 * Bounded, resumable runner for the erasure steps before Auth deletion (TASK-011, BR-14, BR-15).
 *
 * Forward-only: a step advances only after its handler reports `done`, and the runner never moves a step backward.
 * `auth_delete` and `final_sweep` belong to TASK-037; the runner hands off when it reaches `auth_delete`.
 * Handlers are injected. Real handlers arrive in TASK-014 to TASK-024.
 */

/** `done` is returned only after the step's own verification query finds zero matches. */
export type BatchResult = "more" | "done";

export interface StepHandler {
  runBatch(input: { uid: string; maxWrites: number }): Promise<BatchResult>;
}

/**
 * A handler throws this to report a classified failure. The message is the code itself. Any other thrown value is
 * recorded as `unexpected`, and its message is never stored or logged (AE-SI-12).
 */
export class ErasureStepFailure extends Error {
  constructor(readonly code: ErasureRecordErrorCode) {
    super(code);
  }
}

export interface RunBudget {
  readonly maxBatches: number;
  readonly writesPerBatch: number;
  readonly wallMs: number;
}

export const DEFAULT_RUN_BUDGET: RunBudget = {
  maxBatches: MAX_BATCHES_PER_REQUEST,
  writesPerBatch: WRITES_PER_BATCH,
  wallMs: REQUEST_WALL_BUDGET_MS,
};

export interface RunnerDeps {
  readonly port: ErasureStorePort;
  readonly handlers: Partial<Record<ErasureStep, StepHandler>>;
  /** Monotonic millisecond clock, injected for the wall-time budget. */
  readonly clockMs: () => number;
  readonly now: () => Date;
  readonly budget?: RunBudget;
}

export type RunOutcome =
  | { status: "in_progress"; step: ErasureStep; reason: "budget_exhausted" }
  | { status: "handoff"; step: "auth_delete" }
  | { status: "failed"; step: ErasureStep; errorCode: ErasureRecordErrorCode }
  | { status: "not_running" }
  | { status: "store_error"; error: StoreError };

export async function runErasure(deps: RunnerDeps, uid: string): Promise<RunOutcome> {
  const budget = deps.budget ?? DEFAULT_RUN_BUDGET;

  const current = await readErasureRecord(deps.port, uid);
  if (!current.ok) {
    return current.error === "not_found" ? { status: "not_running" } : { status: "store_error", error: current.error };
  }
  if (current.value.status !== "in_progress") return { status: "not_running" };

  const startedMs = deps.clockMs();
  let batches = 0;
  let step: ErasureStep = current.value.step;

  for (;;) {
    if (step === "auth_delete") return { status: "handoff", step };

    const handler = deps.handlers[step];
    if (handler === undefined) return fail(deps, uid, step, "unexpected");

    for (;;) {
      if (batches >= budget.maxBatches || deps.clockMs() - startedMs >= budget.wallMs) {
        return { status: "in_progress", step, reason: "budget_exhausted" };
      }
      batches += 1;

      let result: BatchResult;
      try {
        result = await handler.runBatch({ uid, maxWrites: budget.writesPerBatch });
      } catch (error) {
        return fail(deps, uid, step, error instanceof ErasureStepFailure ? error.code : "unexpected");
      }
      if (result === "done") break;
    }

    const next = nextStep(step);
    // Only `final_sweep` has no successor, and the runner never reaches it (it hands off at `auth_delete`).
    if (next === undefined) return fail(deps, uid, step, "unexpected");
    const advanced = await advanceErasureStep(deps.port, uid, next, deps.now());
    if (!advanced.ok) return { status: "store_error", error: advanced.error };
    step = next;
  }
}

function nextStep(step: ErasureStep): ErasureStep | undefined {
  return ERASURE_STEPS[ERASURE_STEPS.indexOf(step) + 1];
}

async function fail(
  deps: RunnerDeps,
  uid: string,
  step: ErasureStep,
  errorCode: ErasureRecordErrorCode,
): Promise<RunOutcome> {
  const recorded = await recordErasureError(deps.port, uid, errorCode, deps.now());
  if (!recorded.ok) return { status: "store_error", error: recorded.error };
  return { status: "failed", step, errorCode };
}
