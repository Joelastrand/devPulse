import { describe, expect, it, vi } from "vitest";
import type { ErasureStep } from "../domain/erasure-state";
import { createFakeErasureStore } from "./erasure-store-fake";
import { ErasureStepFailure, runErasure, type BatchResult, type RunBudget } from "./erasure-runner";
import { createErasureInTransaction, readErasureRecord } from "./erasure-store";
import { INVENTORY_ROWS, sweepQueriesForRow, type InventorySweep } from "./inventory";
import {
  ROW_OWNING_STEP,
  createVerifyHandler,
  runVerificationSweep,
  type SweepBinding,
  type SweepCounter,
} from "./verification-sweep";

vi.mock("server-only", () => ({}));

const UID = "uid-sweep-test-1";
const EMAIL = "fixture.person@example.test";
const NOW = new Date("2026-10-29T10:00:00.000Z");
const BINDING: SweepBinding = { uid: UID, normalizedEmail: EMAIL };
const BUDGET: RunBudget = { maxBatches: 50, writesPerBatch: 100, wallMs: 1_000_000 };

/** A counter whose residuals are set per row id. Each sweep query of a listed row returns its configured count. */
function countsFor(residuals: Record<string, number>): SweepCounter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async countMatches(sweep: InventorySweep) {
      calls.push(sweep.rowId);
      return residuals[sweep.rowId] ?? 0;
    },
  };
}

/** Owners written from the SPEC "Steps" table (SPEC lines for forum, memberships, conversations_owned, participant_bindings, locators, personal_data, survey_participations, actor_audit). Not derived from ROW_OWNING_STEP. */
const SPEC_OWNING_STEP: Readonly<Record<ErasureStep, readonly string[]>> = {
  forum: ["I-13", "I-14"],
  memberships: ["I-9", "I-10", "I-11", "A-5", "A-14", "A-15"],
  conversations_owned: ["I-5"],
  participant_bindings: ["I-7", "I-8"],
  locators: ["I-6"],
  personal_data: ["I-1", "I-2", "I-3", "I-4", "I-16"],
  survey_participations: ["I-12"],
  actor_audit: ["A-1", "A-2", "A-3", "A-4", "A-6", "A-7", "A-8", "A-9", "A-10", "A-11", "A-12", "A-13", "A-16"],
  verify_data: [],
  auth_delete: [],
  final_sweep: [],
};

describe("verification sweep owning steps (TASK-012)", () => {
  it("names an owning step for every row that has a sweep, and for no other row", () => {
    const sweepable = INVENTORY_ROWS.filter((row) => sweepQueriesForRow(row).length > 0).map((row) => row.id);
    expect(Object.keys(ROW_OWNING_STEP).sort()).toEqual([...sweepable].sort());
  });

  it("matches the SPEC step table row for row", () => {
    const fromSpec: Record<string, string> = {};
    for (const [step, rowIds] of Object.entries(SPEC_OWNING_STEP)) {
      for (const rowId of rowIds) fromSpec[rowId] = step;
    }
    expect(ROW_OWNING_STEP).toEqual(fromSpec);
  });

  it("never routes a residual back to verify_data or a later step", () => {
    const owners = new Set(Object.values(ROW_OWNING_STEP));
    expect(owners.has("verify_data")).toBe(false);
    expect(owners.has("auth_delete")).toBe(false);
    expect(owners.has("final_sweep")).toBe(false);
  });
});

describe("verification sweep result (TASK-012)", () => {
  it("passes with zero matches, including the per-membership rows", async () => {
    const counter = countsFor({});
    const report = await runVerificationSweep(counter, BINDING);

    expect(report.complete).toBe(true);
    expect(report.residualsByStep).toEqual({});
    expect(counter.calls).toEqual(expect.arrayContaining(["A-5", "I-9", "I-7", "A-14", "A-15"]));
  });

  it.each(["A-5", "I-9", "I-7", "A-14", "A-15"])(
    "does not complete while a per-membership residual remains in row %s",
    async (rowId) => {
      const report = await runVerificationSweep(countsFor({ [rowId]: 1 }), BINDING);

      expect(report.complete).toBe(false);
      expect(report.residualsByStep[ROW_OWNING_STEP[rowId]]).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(Object.keys(ROW_OWNING_STEP))(
    "routes a single remaining match in row %s back to its owning step",
    async (rowId) => {
      const report = await runVerificationSweep(countsFor({ [rowId]: 1 }), BINDING);

      expect(report.complete).toBe(false);
      expect(Object.keys(report.residualsByStep)).toEqual([ROW_OWNING_STEP[rowId]]);
      expect(report.residualsByStep[ROW_OWNING_STEP[rowId]]).toBeGreaterThanOrEqual(1);
    },
  );

  it("reports only step counts and row ids, never the uid or the e-mail", async () => {
    const report = await runVerificationSweep(countsFor({ "I-2": 2, "A-1": 1 }), BINDING);
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain(UID);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain("example.test");
    expect(Object.keys(report).sort()).toEqual(["complete", "residualsByStep"]);
  });

  it("fails closed as unexpected when the e-mail-bound invitation sweep has no normalized e-mail", async () => {
    const error = await runVerificationSweep(countsFor({}), { uid: UID }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ErasureStepFailure);
    expect((error as ErasureStepFailure).code).toBe("unexpected");
  });
});

describe("verify_data handler (D-VERIFY-BACK, forward-only)", () => {
  it("reports done for a clean sweep and runs no cleanup", async () => {
    const cleanup = vi.fn(async (): Promise<BatchResult> => "done");
    const handler = createVerifyHandler({
      counter: countsFor({}),
      normalizedEmailFor: () => EMAIL,
      cleanups: { forum: { runBatch: cleanup } },
    });

    await expect(handler.runBatch({ uid: UID, maxWrites: 10 })).resolves.toBe("done");
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("re-runs only the owning step's cleanup for a residual and reports more", async () => {
    const forumCleanup = vi.fn(async (): Promise<BatchResult> => "done");
    const actorCleanup = vi.fn(async (): Promise<BatchResult> => "done");
    const handler = createVerifyHandler({
      counter: countsFor({ "I-13": 1 }),
      normalizedEmailFor: () => EMAIL,
      cleanups: { forum: { runBatch: forumCleanup }, actor_audit: { runBatch: actorCleanup } },
    });

    await expect(handler.runBatch({ uid: UID, maxWrites: 10 })).resolves.toBe("more");
    expect(forumCleanup).toHaveBeenCalledWith({ uid: UID, maxWrites: 10 });
    expect(actorCleanup).not.toHaveBeenCalled();
  });

  it("fails closed as unexpected when a residual has no cleanup handler", async () => {
    const handler = createVerifyHandler({
      counter: countsFor({ "I-13": 1 }),
      normalizedEmailFor: () => EMAIL,
      cleanups: {},
    });

    const error = await handler.runBatch({ uid: UID, maxWrites: 10 }).catch((caught: unknown) => caught);
    expect((error as ErasureStepFailure).code).toBe("unexpected");
  });
});

describe("verify_data through the runner (D-VERIFY-BACK)", () => {
  it("keeps the persisted step at verify_data while residuals exist, then advances when the sweep is clean", async () => {
    const store = createFakeErasureStore();
    await createErasureInTransaction(store, UID, NOW);
    store.seed(UID, { ...store.documents.get(UID), step: "verify_data", updatedAt: NOW });

    const counter = countsFor({ "I-13": 2 });
    const cleanupCalls: number[] = [];
    const verify = createVerifyHandler({
      counter,
      normalizedEmailFor: () => EMAIL,
      cleanups: {
        forum: {
          async runBatch(): Promise<BatchResult> {
            cleanupCalls.push(1);
            return "done";
          },
        },
      },
    });

    // Residual present: bounded by the budget, so the runner stops with the step still at verify_data.
    const first = await runErasure({ port: store, handlers: { verify_data: verify }, clockMs: () => 0, now: () => NOW, budget: { ...BUDGET, maxBatches: 3 } }, UID);
    expect(first).toEqual({ status: "in_progress", step: "verify_data", reason: "budget_exhausted" });
    expect(cleanupCalls.length).toBeGreaterThan(0);
    const midRun = await readErasureRecord(store, UID);
    expect(midRun.ok && midRun.value.step).toBe("verify_data");

    // Residual cleared: the same handler now reports done and the runner advances to the hand-off.
    const cleared = countsFor({});
    const verifyClean = createVerifyHandler({ counter: cleared, normalizedEmailFor: () => EMAIL, cleanups: {} });
    const second = await runErasure({ port: store, handlers: { verify_data: verifyClean }, clockMs: () => 0, now: () => NOW, budget: BUDGET }, UID);
    expect(second).toEqual({ status: "handoff", step: "auth_delete" });
  });
});
