import { describe, expect, it, vi } from "vitest";
import { ERASURE_STEPS, type ErasureStep } from "../domain/erasure-state";
import { ERASURE_RECORD_KEYS } from "./erasure-store-types";
import { createFakeErasureStore, type FakeErasureStore } from "./erasure-store-fake";
import {
  ErasureStepFailure,
  runErasure,
  type BatchResult,
  type RunBudget,
  type StepHandler,
} from "./erasure-runner";
import { createErasureInTransaction } from "./erasure-store";

vi.mock("server-only", () => ({}));

const UID = "uid-runner-test-1";
const NOW = new Date("2026-10-28T10:00:00.000Z");
const BUDGET_UNLIMITED: RunBudget = { maxBatches: 1000, writesPerBatch: 100, wallMs: 1_000_000 };

interface Call {
  step: ErasureStep;
  maxWrites: number;
}

/** A handler that reports `more` for `moreCount` batches and then `done`. Records each call. */
function countingHandler(step: ErasureStep, moreCount: number, calls: Call[]): StepHandler {
  let remaining = moreCount;
  return {
    async runBatch({ maxWrites }) {
      calls.push({ step, maxWrites });
      if (remaining > 0) {
        remaining -= 1;
        return "more" as BatchResult;
      }
      return "done" as BatchResult;
    },
  };
}

function handlersFor(
  steps: readonly ErasureStep[],
  moreCountFor: (step: ErasureStep) => number,
  calls: Call[],
): Partial<Record<ErasureStep, StepHandler>> {
  return Object.fromEntries(steps.map((step) => [step, countingHandler(step, moreCountFor(step), calls)]));
}

async function seedInProgress(store: FakeErasureStore, step: ErasureStep): Promise<void> {
  await createErasureInTransaction(store, UID, NOW);
  if (step !== "forum") {
    store.seed(UID, { ...store.documents.get(UID), step, updatedAt: NOW });
  }
}

const BEFORE_AUTH_DELETE = ERASURE_STEPS.slice(0, ERASURE_STEPS.indexOf("auth_delete"));

describe("erasure runner", () => {
  it("runs the steps in order from the stored step and hands off at auth_delete", async () => {
    const store = createFakeErasureStore();
    await seedInProgress(store, "memberships");
    const calls: Call[] = [];

    const outcome = await runErasure(
      {
        port: store,
        handlers: handlersFor(BEFORE_AUTH_DELETE, () => 0, calls),
        clockMs: () => 0,
        now: () => NOW,
        budget: BUDGET_UNLIMITED,
      },
      UID,
    );

    expect(outcome).toEqual({ status: "handoff", step: "auth_delete" });
    expect(calls.map((call) => call.step)).toEqual(
      BEFORE_AUTH_DELETE.slice(BEFORE_AUTH_DELETE.indexOf("memberships")),
    );
    expect(store.documents.get(UID)?.step).toBe("auth_delete");
  });

  it("does not advance a step while its handler reports more", async () => {
    const store = createFakeErasureStore();
    await seedInProgress(store, "forum");
    const calls: Call[] = [];

    const outcome = await runErasure(
      {
        port: store,
        handlers: handlersFor(["forum"], () => 1_000, calls),
        clockMs: () => 0,
        now: () => NOW,
        budget: { maxBatches: 3, writesPerBatch: 100, wallMs: 1_000_000 },
      },
      UID,
    );

    expect(outcome).toEqual({ status: "in_progress", step: "forum", reason: "budget_exhausted" });
    expect(calls).toHaveLength(3);
    expect(store.documents.get(UID)?.step).toBe("forum");
  });

  it("stops after the 10-batch budget with 100 writes per batch", async () => {
    const store = createFakeErasureStore();
    await seedInProgress(store, "forum");
    const calls: Call[] = [];

    const outcome = await runErasure(
      {
        port: store,
        handlers: handlersFor(["forum"], () => 1_000, calls),
        clockMs: () => 0,
        now: () => NOW,
      },
      UID,
    );

    expect(outcome).toEqual({ status: "in_progress", step: "forum", reason: "budget_exhausted" });
    expect(calls).toHaveLength(10);
    expect(calls.every((call) => call.maxWrites === 100)).toBe(true);
  });

  it("stops when the 20 second wall budget is spent, even with batches left", async () => {
    const store = createFakeErasureStore();
    await seedInProgress(store, "forum");
    const calls: Call[] = [];
    let nowMs = 0;
    const handlers: Partial<Record<ErasureStep, StepHandler>> = {
      forum: {
        async runBatch(input) {
          calls.push({ step: "forum", maxWrites: input.maxWrites });
          nowMs += 10_000;
          return "more";
        },
      },
    };

    const outcome = await runErasure(
      {
        port: store,
        handlers,
        clockMs: () => nowMs,
        now: () => NOW,
        budget: { maxBatches: 1000, writesPerBatch: 100, wallMs: 20_000 },
      },
      UID,
    );

    expect(outcome).toEqual({ status: "in_progress", step: "forum", reason: "budget_exhausted" });
    expect(calls).toHaveLength(2);
  });

  it("resumes at the same step after an interruption that ended a batch", async () => {
    const store = createFakeErasureStore();
    await seedInProgress(store, "locators");
    const firstCalls: Call[] = [];
    const secondCalls: Call[] = [];

    const first = await runErasure(
      {
        port: store,
        handlers: handlersFor(["locators"], () => 5, firstCalls),
        clockMs: () => 0,
        now: () => NOW,
        budget: { maxBatches: 1, writesPerBatch: 100, wallMs: 1_000_000 },
      },
      UID,
    );
    expect(first).toEqual({ status: "in_progress", step: "locators", reason: "budget_exhausted" });

    const second = await runErasure(
      {
        port: store,
        handlers: handlersFor(BEFORE_AUTH_DELETE, () => 0, secondCalls),
        clockMs: () => 0,
        now: () => NOW,
        budget: BUDGET_UNLIMITED,
      },
      UID,
    );

    expect(secondCalls[0]?.step).toBe("locators");
    expect(second).toEqual({ status: "handoff", step: "auth_delete" });
  });

  it("records a classified failure, keeps the step, and stops", async () => {
    const store = createFakeErasureStore();
    await seedInProgress(store, "personal_data");
    const handlers: Partial<Record<ErasureStep, StepHandler>> = {
      personal_data: {
        async runBatch() {
          throw new ErasureStepFailure("payload_unreadable");
        },
      },
    };

    const outcome = await runErasure(
      { port: store, handlers, clockMs: () => 0, now: () => NOW, budget: BUDGET_UNLIMITED },
      UID,
    );

    expect(outcome).toEqual({ status: "failed", step: "personal_data", errorCode: "payload_unreadable" });
    expect(store.documents.get(UID)).toMatchObject({ step: "personal_data", errorCode: "payload_unreadable" });
  });

  it("records an unclassified error as unexpected and stores no message", async () => {
    const store = createFakeErasureStore();
    await seedInProgress(store, "forum");
    const handlers: Partial<Record<ErasureStep, StepHandler>> = {
      forum: {
        async runBatch() {
          throw new Error("PERSONAL secret detail uid-runner-test-1");
        },
      },
    };

    const outcome = await runErasure(
      { port: store, handlers, clockMs: () => 0, now: () => NOW, budget: BUDGET_UNLIMITED },
      UID,
    );

    expect(outcome).toEqual({ status: "failed", step: "forum", errorCode: "unexpected" });
    const stored = store.documents.get(UID) ?? {};
    expect(stored.errorCode).toBe("unexpected");
    expect(JSON.stringify(stored)).not.toContain("PERSONAL");
    for (const key of Object.keys(stored)) expect(ERASURE_RECORD_KEYS).toContain(key);
  });

  it("fails as unexpected when a step has no handler, and does not advance", async () => {
    const store = createFakeErasureStore();
    await seedInProgress(store, "memberships");

    const outcome = await runErasure(
      { port: store, handlers: {}, clockMs: () => 0, now: () => NOW, budget: BUDGET_UNLIMITED },
      UID,
    );

    expect(outcome).toEqual({ status: "failed", step: "memberships", errorCode: "unexpected" });
    expect(store.documents.get(UID)?.step).toBe("memberships");
  });

  it("does nothing for a record that is not in progress", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, {
      status: "auth_deleted",
      step: "final_sweep",
      startedAt: NOW,
      updatedAt: NOW,
    });
    const calls: Call[] = [];

    const outcome = await runErasure(
      {
        port: store,
        handlers: handlersFor(["final_sweep"], () => 0, calls),
        clockMs: () => 0,
        now: () => NOW,
        budget: BUDGET_UNLIMITED,
      },
      UID,
    );

    expect(outcome).toEqual({ status: "not_running" });
    expect(calls).toHaveLength(0);
  });

  it("reports not_running when no record exists", async () => {
    const store = createFakeErasureStore();
    const outcome = await runErasure(
      { port: store, handlers: {}, clockMs: () => 0, now: () => NOW, budget: BUDGET_UNLIMITED },
      UID,
    );
    expect(outcome).toEqual({ status: "not_running" });
  });

  it("surfaces a store read failure as store_error and runs no handler", async () => {
    const store = createFakeErasureStore();
    await seedInProgress(store, "forum");
    store.failNextRead();
    const calls: Call[] = [];

    const outcome = await runErasure(
      {
        port: store,
        handlers: handlersFor(["forum"], () => 0, calls),
        clockMs: () => 0,
        now: () => NOW,
        budget: BUDGET_UNLIMITED,
      },
      UID,
    );

    expect(outcome).toEqual({ status: "store_error", error: "store_unavailable" });
    expect(calls).toHaveLength(0);
  });
});
