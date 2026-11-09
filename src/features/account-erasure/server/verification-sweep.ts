import type { ErasureStep } from "../domain/erasure-state";
import { ErasureStepFailure, type BatchResult, type StepHandler } from "./erasure-runner";
import { inventorySweeps, type InventorySweep } from "./inventory";

/**
 * Verification sweep (TASK-012, BR-5, D-VERIFY-BACK option (a)). Re-runs the inventory sweep queries for one person and
 * reports counts per owning step only. It never returns a uid, an e-mail, a document id or content (AE-SI-12).
 *
 * Forward-only: a residual keeps the persisted step at `verify_data`. The verify handler re-runs the owning step's
 * idempotent cleanup and reports `more`. It reports `done`, and the runner advances, only when the sweep is clean.
 *
 * `complete` covers every row with a sweep, including the per-membership `memberRef` rows (A-5, A-14, A-15, I-7 and I-9
 * memberRef). Owner decision (2026-11-08) supersedes the BR-17(1) deferral of 2026-11-02: erasure must not report completion
 * while in-scope personal data remains. A per-membership count resolves the person's memberships by uid, so it can find
 * residuals only while those memberships still exist. After the membership step, the completion guarantee rests on that
 * step deleting a membership only once its roadmap, knowledge and participation references are cleared in the same
 * transaction (`membership-erasure.ts`). The production verify handler is wired to the runner (production-erasure-handlers.ts).
 */

export interface SweepBinding {
  readonly uid: string;
  /** Needed only for e-mail-bound sweeps (I-11). The caller supplies it from the verified identity. */
  readonly normalizedEmail?: string;
}

export interface SweepCounter {
  /** Number of documents that match one sweep query. Implementations must not return or log document content. */
  countMatches(sweep: InventorySweep, binding: SweepBinding): Promise<number>;
}

/**
 * The step that owns each sweepable inventory row (SPEC "Steps"). A residual is re-cleaned by this step. Every row that
 * has a sweep is listed; the test fails if a sweepable row is missing.
 */
export const ROW_OWNING_STEP: Readonly<Record<string, ErasureStep>> = {
  "I-1": "personal_data",
  "I-2": "personal_data",
  "I-3": "personal_data",
  "I-4": "personal_data",
  "I-5": "conversations_owned",
  "I-6": "locators",
  "I-7": "participant_bindings",
  "I-8": "participant_bindings",
  "I-9": "memberships",
  "I-10": "memberships",
  "I-11": "memberships",
  "I-12": "survey_participations",
  "I-13": "forum",
  "I-14": "forum",
  "I-16": "personal_data",
  "A-1": "actor_audit",
  "A-16": "actor_audit",
  "A-2": "actor_audit",
  "A-3": "actor_audit",
  "A-4": "actor_audit",
  "A-5": "memberships",
  "A-6": "actor_audit",
  "A-7": "actor_audit",
  "A-8": "actor_audit",
  "A-9": "actor_audit",
  "A-10": "actor_audit",
  "A-11": "actor_audit",
  "A-12": "actor_audit",
  "A-13": "actor_audit",
  "A-14": "memberships",
  "A-15": "memberships",
};

export interface SweepReport {
  /** Residual match counts for steps that still own matches. Empty when the uid and e-mail sweeps are clean. */
  readonly residualsByStep: Partial<Record<ErasureStep, number>>;
  readonly complete: boolean;
}

function needsEmail(sweep: InventorySweep): boolean {
  const { query } = sweep;
  return query.kind === "docIdEndsWith" || (query.kind === "fieldEquals" && query.value === "email");
}

export async function runVerificationSweep(counter: SweepCounter, binding: SweepBinding): Promise<SweepReport> {
  const residualsByStep: Partial<Record<ErasureStep, number>> = {};

  for (const sweep of inventorySweeps()) {
    // Fail closed: an e-mail-bound row cannot be verified without the normalized e-mail, so it is never reported clean.
    if (needsEmail(sweep) && binding.normalizedEmail === undefined) throw new ErasureStepFailure("unexpected");

    const count = await counter.countMatches(sweep, binding);
    if (count === 0) continue;

    const owner = ROW_OWNING_STEP[sweep.rowId];
    if (owner === undefined) throw new ErasureStepFailure("unexpected");
    residualsByStep[owner] = (residualsByStep[owner] ?? 0) + count;
  }

  return {
    residualsByStep,
    complete: Object.keys(residualsByStep).length === 0,
  };
}

export interface VerifyHandlerDeps {
  readonly counter: SweepCounter;
  /** The normalized e-mail of the verified caller, if the caller has one. */
  readonly normalizedEmailFor: (uid: string) => string | undefined;
  /** Idempotent cleanup per owning step. A residual for a step without a cleanup handler fails closed. */
  readonly cleanups: Partial<Record<ErasureStep, StepHandler>>;
}

/**
 * The `verify_data` handler. Returns `done` only for a clean sweep. Otherwise it re-runs one bounded batch of each
 * residual step's cleanup and returns `more`, so the persisted step stays at `verify_data` (D-VERIFY-BACK).
 */
export function createVerifyHandler(deps: VerifyHandlerDeps): StepHandler {
  return {
    async runBatch({ uid, maxWrites }): Promise<BatchResult> {
      const normalizedEmail = deps.normalizedEmailFor(uid);
      const report = await runVerificationSweep(deps.counter, { uid, normalizedEmail });
      if (report.complete) return "done";

      for (const step of Object.keys(report.residualsByStep) as ErasureStep[]) {
        const cleanup = deps.cleanups[step];
        if (cleanup === undefined) throw new ErasureStepFailure("unexpected");
        await cleanup.runBatch({ uid, maxWrites });
      }
      return "more";
    },
  };
}
