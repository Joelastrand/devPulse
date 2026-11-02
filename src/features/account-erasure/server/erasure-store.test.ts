import { describe, expect, it, vi } from "vitest";
import { COMPLETED_RECORD_TTL_MS } from "../domain/erasure-constants";
import { ERASURE_RECORD_KEYS, type ErasureStorePort, type ErasureTransaction } from "./erasure-store-types";
import {
  advanceErasureStep,
  completeErasure,
  createErasureInTransaction,
  markErasureAuthDeleted,
  readErasureForFence,
  recordErasureError,
} from "./erasure-store";
import { createFakeErasureStore, type FakeErasureStore } from "./erasure-store-fake";

vi.mock("server-only", () => ({}));

const UID = "uid-erasure-test-1";
const NOW = new Date("2026-10-28T10:00:00.000Z");
const LATER = new Date("2026-10-28T10:05:00.000Z");

function inProgress(step: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: "in_progress", step, startedAt: NOW, updatedAt: NOW, ...overrides };
}

function fenceRead(store: ErasureStorePort, uid: string) {
  return store.runTransaction((tx: ErasureTransaction) => readErasureForFence(tx, uid));
}

function assertOnlyAllowedKeys(document: Record<string, unknown> | undefined): void {
  expect(document).toBeDefined();
  for (const key of Object.keys(document ?? {})) {
    expect(ERASURE_RECORD_KEYS).toContain(key);
  }
}

describe("createErasureInTransaction", () => {
  it("creates one record at step forum with only the allowed keys", async () => {
    const store = createFakeErasureStore();

    const result = await createErasureInTransaction(store, UID, NOW);

    expect(result).toEqual({
      ok: true,
      value: { created: true, record: { status: "in_progress", step: "forum", startedAt: NOW, updatedAt: NOW } },
    });
    expect(store.documents.get(UID)).toEqual(inProgress("forum"));
    assertOnlyAllowedKeys(store.documents.get(UID));
  });

  it("returns the existing record on a second call and never restarts it", async () => {
    const store = createFakeErasureStore();
    await createErasureInTransaction(store, UID, NOW);
    await advanceErasureStep(store, UID, "memberships", LATER);

    const second = await createErasureInTransaction(store, UID, LATER);

    expect(second.ok && second.value.created).toBe(false);
    expect(second.ok && second.value.record.step).toBe("memberships");
    expect(store.documents.get(UID)?.startedAt).toEqual(NOW);
  });

  it("refuses to start over a malformed record and leaves it untouched", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("forum", { email: "someone@example.com" }));
    const before = structuredClone(store.documents.get(UID));

    const result = await createErasureInTransaction(store, UID, NOW);

    expect(result).toEqual({ ok: false, error: "malformed" });
    expect(store.documents.get(UID)).toEqual(before);
  });

  it("surfaces a read failure as store_unavailable and creates nothing", async () => {
    const store = createFakeErasureStore();
    store.failNextRead();

    const result = await createErasureInTransaction(store, UID, NOW);

    expect(result).toEqual({ ok: false, error: "store_unavailable" });
    expect(store.documents.has(UID)).toBe(false);
  });
});

describe("readErasureForFence", () => {
  it("reports none when no record exists", async () => {
    const store = createFakeErasureStore();
    expect(await fenceRead(store, UID)).toEqual({ ok: true, value: "none" });
  });

  it.each([
    ["in_progress", () => inProgress("forum")],
    ["auth_deleted", () => inProgress("auth_delete", { status: "auth_deleted" })],
    [
      "completed",
      () =>
        inProgress("final_sweep", {
          status: "completed",
          completedAt: LATER,
          expireAt: new Date(LATER.getTime() + COMPLETED_RECORD_TTL_MS),
        }),
    ],
  ])("reports %s from the stored status", async (expected, build) => {
    const store = createFakeErasureStore();
    store.seed(UID, build());
    expect(await fenceRead(store, UID)).toEqual({ ok: true, value: expected });
  });

  it("reports a malformed record as malformed, never as none", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("forum", { status: "deleted" }));
    expect(await fenceRead(store, UID)).toEqual({ ok: true, value: "malformed" });
  });

  it("treats a completed record without its terminal fields as malformed", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("final_sweep", { status: "completed" }));
    expect(await fenceRead(store, UID)).toEqual({ ok: true, value: "malformed" });
  });

  it("treats a record with an unexpected key (for example an e-mail) as malformed", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("forum", { uid: UID }));
    expect(await fenceRead(store, UID)).toEqual({ ok: true, value: "malformed" });
  });

  it("reads through the transaction (tx.get), not a plain read", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("forum"));
    await fenceRead(store, UID);
    expect(store.transactionalReads).toEqual([UID]);
  });

  it("returns store_unavailable on a read failure, so the caller fails closed", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("forum"));
    store.failNextRead();
    expect(await fenceRead(store, UID)).toEqual({ ok: false, error: "store_unavailable" });
  });
});

describe("forward-only step and status writes", () => {
  it("advances the step forward while in progress", async () => {
    const store = createFakeErasureStore();
    await createErasureInTransaction(store, UID, NOW);

    const result = await advanceErasureStep(store, UID, "memberships", LATER);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(store.documents.get(UID)).toEqual(inProgress("memberships", { updatedAt: LATER }));
  });

  it("refuses a backward step and writes nothing", async () => {
    const store = createFakeErasureStore();
    await createErasureInTransaction(store, UID, NOW);
    await advanceErasureStep(store, UID, "memberships", LATER);
    const before = structuredClone(store.documents.get(UID));

    const result = await advanceErasureStep(store, UID, "forum", LATER);

    expect(result).toEqual({ ok: false, error: "invalid_transition" });
    expect(store.documents.get(UID)).toEqual(before);
  });

  it("refuses to skip steps: forum to auth_delete leaves the step unchanged", async () => {
    const store = createFakeErasureStore();
    await createErasureInTransaction(store, UID, NOW);
    const before = structuredClone(store.documents.get(UID));

    const result = await advanceErasureStep(store, UID, "auth_delete", LATER);

    expect(result).toEqual({ ok: false, error: "invalid_transition" });
    expect(store.documents.get(UID)).toEqual(before);
  });

  it("allows the move into final_sweep after auth deletion", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("auth_delete", { status: "auth_deleted" }));
    expect(await advanceErasureStep(store, UID, "final_sweep", LATER)).toEqual({ ok: true, value: undefined });
    expect(store.documents.get(UID)?.step).toBe("final_sweep");
  });

  it("refuses any other step move after auth deletion", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("auth_delete", { status: "auth_deleted" }));
    expect(await advanceErasureStep(store, UID, "verify_data", LATER)).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("refuses a move into final_sweep while in_progress (only auth_deleted may reach it)", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("auth_delete"));
    expect(await advanceErasureStep(store, UID, "final_sweep", LATER)).toEqual({ ok: false, error: "invalid_transition" });
    expect(store.documents.get(UID)?.step).toBe("auth_delete");
  });

  it("refuses a step advance on a completed record", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("final_sweep", { status: "completed", completedAt: NOW, expireAt: LATER }));
    expect(await advanceErasureStep(store, UID, "final_sweep", LATER)).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("refuses a step advance on a missing record", async () => {
    const store = createFakeErasureStore();
    expect(await advanceErasureStep(store, UID, "memberships", LATER)).toEqual({ ok: false, error: "not_found" });
  });

  it("marks auth deleted only from in_progress at auth_delete", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("auth_delete"));

    expect(await markErasureAuthDeleted(store, UID, LATER)).toEqual({ ok: true, value: undefined });
    expect(store.documents.get(UID)?.status).toBe("auth_deleted");
  });

  it("refuses auth-deleted marking before the auth_delete step", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("verify_data"));
    expect(await markErasureAuthDeleted(store, UID, LATER)).toEqual({ ok: false, error: "invalid_transition" });
    expect(store.documents.get(UID)?.status).toBe("in_progress");
  });

  it("does not restamp a record that is already auth_deleted", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("auth_delete", { status: "auth_deleted" }));
    expect(await markErasureAuthDeleted(store, UID, LATER)).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("completes only from auth_deleted at final_sweep, with completedAt and a 24 hour expireAt", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("final_sweep", { status: "auth_deleted" }));

    expect(await completeErasure(store, UID, LATER)).toEqual({ ok: true, value: undefined });

    expect(store.documents.get(UID)).toEqual({
      status: "completed",
      step: "final_sweep",
      startedAt: NOW,
      updatedAt: LATER,
      completedAt: LATER,
      expireAt: new Date(LATER.getTime() + 86_400_000),
    });
  });

  it("refuses completion from in_progress (no skipping auth deletion)", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("final_sweep"));
    expect(await completeErasure(store, UID, LATER)).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("does not re-complete a completed record or move its expireAt", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("final_sweep", { status: "auth_deleted" }));
    await completeErasure(store, UID, NOW);
    const before = structuredClone(store.documents.get(UID));

    expect(await completeErasure(store, UID, LATER)).toEqual({ ok: false, error: "invalid_transition" });
    expect(store.documents.get(UID)).toEqual(before);
  });
});

describe("recordErasureError", () => {
  it("stores only the closed error code, never a message", async () => {
    const store = createFakeErasureStore();
    await createErasureInTransaction(store, UID, NOW);

    expect(await recordErasureError(store, UID, "store_unavailable", LATER)).toEqual({
      ok: true,
      value: undefined,
    });

    expect(store.documents.get(UID)).toEqual({ ...inProgress("forum"), updatedAt: LATER, errorCode: "store_unavailable" });
    assertOnlyAllowedKeys(store.documents.get(UID));
  });

  it("refuses to attach an error to a completed record", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, inProgress("final_sweep", { status: "completed", completedAt: NOW, expireAt: LATER }));
    expect(await recordErasureError(store, UID, "unexpected", LATER)).toEqual({ ok: false, error: "invalid_transition" });
  });
});

describe("persisted shape across a full lifecycle", () => {
  it("writes only allowed keys at every step", async () => {
    const store: FakeErasureStore = createFakeErasureStore();
    await createErasureInTransaction(store, UID, NOW);
    assertOnlyAllowedKeys(store.documents.get(UID));

    const stepsBeforeAuthDelete = [
      "memberships",
      "conversations_owned",
      "participant_bindings",
      "locators",
      "personal_data",
      "survey_participations",
      "actor_audit",
      "verify_data",
      "auth_delete",
    ] as const;
    for (const step of stepsBeforeAuthDelete) {
      await advanceErasureStep(store, UID, step, LATER);
      assertOnlyAllowedKeys(store.documents.get(UID));
    }
    await markErasureAuthDeleted(store, UID, LATER);
    await advanceErasureStep(store, UID, "final_sweep", LATER);
    await completeErasure(store, UID, LATER);

    assertOnlyAllowedKeys(store.documents.get(UID));
    expect(store.documents.get(UID)?.status).toBe("completed");
  });
});
