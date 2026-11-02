import { describe, expect, it, vi } from "vitest";
import { createFakeErasureStore, type FakeErasureStore } from "./erasure-store-fake";
import { runAuthDeletion, type AuthDeletionPort, type AuthDeleteResult } from "./auth-deletion";

const UID = "uid-37";
const NOW = new Date("2026-10-29T12:00:00Z");

function record(status: "in_progress" | "auth_deleted", step: string, extra: Record<string, unknown> = {}) {
  return { status, step, startedAt: NOW, updatedAt: NOW, ...extra };
}

function auth(result: AuthDeleteResult = "deleted"): AuthDeletionPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async deleteUser(uid) {
      calls.push(uid);
      return result;
    },
  };
}

function deps(store: FakeErasureStore, authPort: AuthDeletionPort, sweepClean = true) {
  return {
    port: store,
    auth: authPort,
    finalSweep: vi.fn(async () => sweepClean),
    now: () => NOW,
  };
}

describe("auth_delete ordering", () => {
  it("never deletes Auth while the record is still at verify_data (no ordering bypass)", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, record("in_progress", "verify_data"));
    const authPort = auth();

    expect(await runAuthDeletion(deps(store, authPort), UID)).toEqual({ status: "not_running" });
    expect(authPort.calls).toEqual([]);
    expect(store.documents.get(UID)).toMatchObject({ status: "in_progress", step: "verify_data" });
  });

  it("reports not_running for an unknown uid without touching Auth", async () => {
    const store = createFakeErasureStore();
    const authPort = auth();

    expect(await runAuthDeletion(deps(store, authPort), UID)).toEqual({ status: "not_running" });
    expect(authPort.calls).toEqual([]);
  });
});

describe("auth_delete step", () => {
  it("deletes the Auth user, then marks the record auth_deleted at auth_delete", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, record("in_progress", "auth_delete"));
    const authPort = auth("deleted");

    const outcome = await runAuthDeletion(deps(store, authPort, false), UID);

    expect(outcome).toEqual({ status: "auth_deleted" });
    expect(authPort.calls).toEqual([UID]);
    expect(store.documents.get(UID)).toMatchObject({ status: "auth_deleted", step: "auth_delete" });
  });

  it("treats user-not-found on retry as success", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, record("in_progress", "auth_delete"));

    expect(await runAuthDeletion(deps(store, auth("not_found")), UID)).toEqual({ status: "auth_deleted" });
    expect(store.documents.get(UID)).toMatchObject({ status: "auth_deleted" });
  });

  it("stores auth_unavailable on a transient failure and leaves the step at auth_delete", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, record("in_progress", "auth_delete"));

    const outcome = await runAuthDeletion(deps(store, auth("unavailable")), UID);

    expect(outcome).toEqual({ status: "failed", step: "auth_delete", errorCode: "auth_unavailable" });
    expect(store.documents.get(UID)).toMatchObject({
      status: "in_progress",
      step: "auth_delete",
      errorCode: "auth_unavailable",
    });
  });
});

describe("final_sweep and completion", () => {
  it("advances auth_deleted from auth_delete to final_sweep, then completes with completedAt and expireAt 24h later", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, record("auth_deleted", "auth_delete"));
    const authPort = auth();

    const outcome = await runAuthDeletion(deps(store, authPort, true), UID);

    expect(outcome).toEqual({ status: "completed" });
    expect(authPort.calls).toEqual([]);
    const stored = store.documents.get(UID) as { completedAt: Date; expireAt: Date };
    expect(stored).toMatchObject({ status: "completed", step: "final_sweep" });
    expect(stored.completedAt.getTime()).toBe(NOW.getTime());
    expect(stored.expireAt.getTime() - stored.completedAt.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("completes a record already at final_sweep without deleting Auth again", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, record("auth_deleted", "final_sweep"));
    const authPort = auth();

    expect(await runAuthDeletion(deps(store, authPort, true), UID)).toEqual({ status: "completed" });
    expect(authPort.calls).toEqual([]);
  });

  it("a non-zero final sweep stores verification_failed and stays auth_deleted", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, record("auth_deleted", "final_sweep"));

    const outcome = await runAuthDeletion(deps(store, auth(), false), UID);

    expect(outcome).toEqual({ status: "failed", step: "final_sweep", errorCode: "verification_failed" });
    expect(store.documents.get(UID)).toMatchObject({
      status: "auth_deleted",
      step: "final_sweep",
      errorCode: "verification_failed",
    });
    expect(store.documents.get(UID)).not.toHaveProperty("completedAt");
  });

  it("does not complete a record that is still in_progress at final_sweep", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, record("in_progress", "final_sweep"));
    const finalSweep = vi.fn(async () => true);

    expect(await runAuthDeletion({ ...deps(store, auth()), finalSweep }, UID)).toEqual({ status: "not_running" });
    expect(finalSweep).not.toHaveBeenCalled();
  });
});

describe("retry and terminal-state safety", () => {
  it("a completed record returns not_running with no store write and no Auth call", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, { ...record("auth_deleted", "final_sweep"), status: "completed", completedAt: NOW, expireAt: NOW });
    const before = structuredClone(store.documents.get(UID));
    const authPort = auth();

    expect(await runAuthDeletion(deps(store, authPort, true), UID)).toEqual({ status: "not_running" });
    expect(authPort.calls).toEqual([]);
    expect(store.documents.get(UID)).toEqual(before);
  });

  it("when the status write fails after deleteUser succeeds, a retry reads not_found and completes the mark", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, record("in_progress", "auth_delete"));
    let writes = 0;
    const flaky: typeof store = {
      ...store,
      runTransaction(work) {
        writes += 1;
        // The second transaction is the status write (the first is the read). Fail it once.
        if (writes === 2) return Promise.reject(new Error("store outage"));
        return store.runTransaction(work);
      },
    };

    const first = await runAuthDeletion(deps(flaky, auth("deleted")), UID);
    expect(first.status).toBe("store_error");
    expect(store.documents.get(UID)).toMatchObject({ status: "in_progress", step: "auth_delete" });

    const retry = await runAuthDeletion(deps(store, auth("not_found")), UID);
    expect(retry).toEqual({ status: "auth_deleted" });
    expect(store.documents.get(UID)).toMatchObject({ status: "auth_deleted" });
  });
});
