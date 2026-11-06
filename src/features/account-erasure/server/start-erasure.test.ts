import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFakeErasureStore } from "./erasure-store-fake";
import { ErasureStepFailure, type StepHandler } from "./erasure-runner";
import { startOrResumeErasure, type StartErasureDeps } from "./start-erasure";
import { ERASURE_STEPS, type ErasureStep } from "../domain/erasure-state";

const NOW_SECONDS = 1_800_000_000;
const FRESH_AUTH = NOW_SECONDS - 30;
const STALE_AUTH = NOW_SECONDS - 24 * 60 * 60;
const EMAIL = "dev@example.com";
const UID = "uid-a";

const noRecordFence = async () => ({ kind: "none" as const });
const inProgressFence = async () => ({ kind: "in_progress" as const });

function tokenFor(authTime: number | undefined, uid = UID, email = EMAIL, emailVerified = true) {
  return vi.fn().mockResolvedValue({
    uid,
    email,
    email_verified: emailVerified,
    ...(authTime === undefined ? {} : { auth_time: authTime }),
  });
}

/** Handlers for every step the runner executes before handing off at `auth_delete`. Each records its calls. */
function recordingHandlers(calls: ErasureStep[], overrides: Partial<Record<ErasureStep, StepHandler>> = {}) {
  const handlers: Partial<Record<ErasureStep, StepHandler>> = {};
  for (const step of ERASURE_STEPS.slice(0, ERASURE_STEPS.indexOf("auth_delete"))) {
    handlers[step] = overrides[step] ?? {
      runBatch: async () => {
        calls.push(step);
        return "done";
      },
    };
  }
  return handlers;
}

function depsWith(overrides: Partial<StartErasureDeps> & Pick<StartErasureDeps, "port">): StartErasureDeps {
  return {
    handlers: {},
    clockMs: () => 0,
    now: () => new Date(NOW_SECONDS * 1000),
    nowSeconds: () => NOW_SECONDS,
    ready: true,
    revokeSuperadminForErasure: async () => ({ ok: true as const }),
    ...overrides,
  };
}

const storedAt = new Date(NOW_SECONDS * 1000 - 60_000);

describe("startOrResumeErasure (TASK-013 operation)", () => {
  it("refuses a new start while production is not ready, with no record created and no handler run", async () => {
    const store = createFakeErasureStore();
    const calls: ErasureStep[] = [];
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers(calls),
      ready: false,
      verifyToken: tokenFor(FRESH_AUTH),
      readFence: noRecordFence,
    });

    const result = await startOrResumeErasure("token", { confirmation: EMAIL }, deps);

    expect(result).toEqual({ ok: false, error: "erasure_unavailable" });
    expect(store.documents.size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("refuses to start when the e-mail is not verified, before any record or step (BR-2 verified provenance)", async () => {
    const store = createFakeErasureStore();
    const calls: ErasureStep[] = [];
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers(calls),
      verifyToken: tokenFor(FRESH_AUTH, UID, EMAIL, false),
      readFence: noRecordFence,
    });

    const result = await startOrResumeErasure("token", { confirmation: EMAIL }, deps);

    expect(result).toEqual({ ok: false, error: "erasure_unavailable" });
    expect(store.documents.size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("refuses to resume an in-progress erasure when the e-mail is not verified, and runs no step", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, { status: "in_progress", step: "forum", startedAt: storedAt, updatedAt: storedAt });
    const before = store.documents.get(UID);
    const calls: ErasureStep[] = [];
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers(calls),
      verifyToken: tokenFor(STALE_AUTH, UID, EMAIL, false),
      readFence: inProgressFence,
    });

    const result = await startOrResumeErasure("token", { confirmation: undefined }, deps);

    expect(result).toEqual({ ok: false, error: "erasure_unavailable" });
    expect(calls).toEqual([]);
    expect(store.documents.get(UID)).toEqual(before);
  });

  it("answers a failing final sweep with the fixed unavailable response, with no detail and no unhandled error", async () => {
    const store = createFakeErasureStore();
    const calls: ErasureStep[] = [];
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers(calls),
      verifyToken: tokenFor(FRESH_AUTH),
      readFence: noRecordFence,
      authDeletion: () => ({
        auth: { deleteUser: vi.fn(async () => "deleted" as const) },
        finalSweep: vi.fn(async () => {
          throw new Error("firestore unavailable: internal detail for " + UID);
        }),
      }),
    });

    const result = await startOrResumeErasure("token", { confirmation: EMAIL }, deps);

    expect(result).toEqual({ ok: false, error: "erasure_unavailable" });
    expect(JSON.stringify(result)).not.toContain("internal detail");
    expect(store.documents.get(UID)?.status).toBe("auth_deleted");
  });

  it("starts a new erasure when recent auth and the normalized confirmation match, then runs the handlers in order", async () => {
    const store = createFakeErasureStore();
    const calls: ErasureStep[] = [];
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers(calls),
      verifyToken: tokenFor(FRESH_AUTH),
      readFence: noRecordFence,
    });

    const result = await startOrResumeErasure("token", { confirmation: "  Dev@Example.com " }, deps);

    expect(result).toEqual({ ok: true, state: { status: "in_progress", step: "auth_delete" } });
    expect(calls).toEqual(ERASURE_STEPS.slice(0, ERASURE_STEPS.indexOf("auth_delete")));
    expect(store.documents.get(UID)?.status).toBe("in_progress");
  });

  it("refuses a new start with a stale auth_time as recent_auth_required, creating no record", async () => {
    const store = createFakeErasureStore();
    const deps = depsWith({ port: store, verifyToken: tokenFor(STALE_AUTH), readFence: noRecordFence });

    const result = await startOrResumeErasure("token", { confirmation: EMAIL }, deps);

    expect(result).toEqual({ ok: false, error: "recent_auth_required" });
    expect(store.documents.has(UID)).toBe(false);
  });

  it("refuses a new start without a token auth_time as recent_auth_required", async () => {
    const store = createFakeErasureStore();
    const deps = depsWith({ port: store, verifyToken: tokenFor(undefined), readFence: noRecordFence });

    expect(await startOrResumeErasure("token", { confirmation: EMAIL }, deps)).toEqual({
      ok: false,
      error: "recent_auth_required",
    });
    expect(store.documents.has(UID)).toBe(false);
  });

  it("refuses a new start whose confirmation does not match the verified email, creating no record", async () => {
    const store = createFakeErasureStore();
    const deps = depsWith({ port: store, verifyToken: tokenFor(FRESH_AUTH), readFence: noRecordFence });

    const result = await startOrResumeErasure("token", { confirmation: "other@example.com" }, deps);

    expect(result).toEqual({ ok: false, error: "confirmation_mismatch" });
    expect(store.documents.has(UID)).toBe(false);
  });

  it("refuses a new start with no confirmation as confirmation_mismatch", async () => {
    const store = createFakeErasureStore();
    const deps = depsWith({ port: store, verifyToken: tokenFor(FRESH_AUTH), readFence: noRecordFence });

    expect(await startOrResumeErasure("token", {}, deps)).toEqual({ ok: false, error: "confirmation_mismatch" });
    expect(store.documents.has(UID)).toBe(false);
  });

  it("resumes an in-progress erasure from the stored step, without a fresh sign-in or confirmation, and creates no second record", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, { status: "in_progress", step: "personal_data", startedAt: storedAt, updatedAt: storedAt });
    const calls: ErasureStep[] = [];
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers(calls),
      verifyToken: tokenFor(STALE_AUTH),
      readFence: inProgressFence,
    });

    const result = await startOrResumeErasure("token", {}, deps);

    expect(result).toEqual({ ok: true, state: { status: "in_progress", step: "auth_delete" } });
    expect(calls).toEqual(["personal_data", "survey_participations", "actor_audit", "verify_data"]);
    expect(store.documents.size).toBe(1);
    expect(store.documents.get(UID)?.startedAt).toEqual(storedAt);
  });

  it("resumes a failed, resumable step on retry, and persists only the closed error code in between", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, { status: "in_progress", step: "forum", startedAt: storedAt, updatedAt: storedAt });
    const calls: ErasureStep[] = [];
    let attempts = 0;
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers(calls, {
        forum: {
          runBatch: async () => {
            attempts += 1;
            if (attempts === 1) throw new ErasureStepFailure("store_unavailable");
            calls.push("forum");
            return "done";
          },
        },
      }),
      verifyToken: tokenFor(STALE_AUTH),
      readFence: inProgressFence,
    });

    const first = await startOrResumeErasure("token", {}, deps);
    expect(first).toEqual({ ok: false, error: "erasure_unavailable" });
    expect(store.documents.get(UID)?.status).toBe("in_progress");
    expect(store.documents.get(UID)?.errorCode).toBe("store_unavailable");

    const retry = await startOrResumeErasure("token", {}, deps);
    expect(retry).toEqual({ ok: true, state: { status: "in_progress", step: "auth_delete" } });
    expect(calls[0]).toBe("forum");
  });

  it("maps an operational failure to erasure_unavailable without leaking the internal error detail", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, { status: "in_progress", step: "forum", startedAt: storedAt, updatedAt: storedAt });
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers([], {
        forum: {
          runBatch: async () => {
            throw new Error(`secret detail for ${EMAIL}`);
          },
        },
      }),
      verifyToken: tokenFor(STALE_AUTH),
      readFence: inProgressFence,
    });

    const result = await startOrResumeErasure("token", {}, deps);

    expect(result).toEqual({ ok: false, error: "erasure_unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain(EMAIL);
  });

  it("fails closed on a malformed record: no step runs and the record is not rewritten", async () => {
    const store = createFakeErasureStore();
    const malformed = { status: "reopened", step: "forum" };
    store.seed(UID, malformed);
    const calls: ErasureStep[] = [];
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers(calls),
      verifyToken: tokenFor(FRESH_AUTH),
      readFence: noRecordFence,
    });

    const result = await startOrResumeErasure("token", { confirmation: EMAIL }, deps);

    expect(result).toEqual({ ok: false, error: "erasure_unavailable" });
    expect(calls).toEqual([]);
    expect(store.documents.get(UID)).toEqual(malformed);
  });

  it("returns the terminal completed result for a completed record and never restarts", async () => {
    const store = createFakeErasureStore();
    const completed = {
      status: "completed",
      step: "final_sweep",
      startedAt: storedAt,
      updatedAt: storedAt,
      completedAt: storedAt,
      expireAt: new Date(NOW_SECONDS * 1000 + 86_400_000),
    };
    store.seed(UID, completed);
    const calls: ErasureStep[] = [];
    // Operation-level only: over HTTP the real fence refuses a terminal record first (see start-erasure-http.test.ts).
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers(calls),
      verifyToken: tokenFor(FRESH_AUTH),
      readFence: noRecordFence,
    });

    const result = await startOrResumeErasure("token", { confirmation: EMAIL }, deps);

    expect(result).toEqual({ ok: true, state: { status: "completed" } });
    expect(calls).toEqual([]);
    expect(store.documents.get(UID)).toEqual(completed);
  });

  it("refuses an auth_deleted record as erasure_unavailable, because the user cannot finish it (operation level)", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, { status: "auth_deleted", step: "auth_delete", startedAt: storedAt, updatedAt: storedAt });
    const calls: ErasureStep[] = [];
    // Operation-level only: over HTTP the real fence refuses a terminal record first (see start-erasure-http.test.ts).
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers(calls),
      verifyToken: tokenFor(FRESH_AUTH),
      readFence: noRecordFence,
    });

    expect(await startOrResumeErasure("token", {}, deps)).toEqual({ ok: false, error: "erasure_unavailable" });
    expect(calls).toEqual([]);
  });

  it("refuses an in-progress resume while production is not ready, without running any handler", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, { status: "in_progress", step: "forum", startedAt: storedAt, updatedAt: storedAt });
    const calls: ErasureStep[] = [];
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers(calls),
      ready: false,
      verifyToken: tokenFor(STALE_AUTH),
      readFence: inProgressFence,
    });

    expect(await startOrResumeErasure("token", {}, deps)).toEqual({ ok: false, error: "erasure_unavailable" });
    expect(calls).toEqual([]);
    expect(store.documents.get(UID)?.errorCode).toBeUndefined();
  });

  it("rejects a request with an invalid token as unauthenticated, before touching the store", async () => {
    const store = createFakeErasureStore();
    const deps = depsWith({
      port: store,
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      readFence: noRecordFence,
    });

    expect(await startOrResumeErasure("token", { confirmation: EMAIL }, deps)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(store.documents.size).toBe(0);
  });
});

describe("startOrResumeErasure and the superadmin privilege (owner decision, Option A)", () => {
  it("refuses to start for the last active superadmin with last_superadmin, creating no fence and running no step", async () => {
    const store = createFakeErasureStore();
    const calls: ErasureStep[] = [];
    const deps = depsWith({
      port: store,
      handlers: recordingHandlers(calls),
      verifyToken: tokenFor(FRESH_AUTH),
      readFence: noRecordFence,
      revokeSuperadminForErasure: async () => ({ ok: false as const, error: "last_superadmin" as const }),
    });

    const result = await startOrResumeErasure("token", { confirmation: EMAIL }, deps);

    expect(result).toEqual({ ok: false, error: "last_superadmin" });
    expect(store.documents.size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("revokes the superadmin privilege before the erasure fence is created", async () => {
    const store = createFakeErasureStore();
    const order: string[] = [];
    const deps = depsWith({
      port: store,
      handlers: {},
      verifyToken: tokenFor(FRESH_AUTH),
      readFence: noRecordFence,
      revokeSuperadminForErasure: async () => {
        order.push(store.documents.size === 0 ? "revoke:no-fence-yet" : "revoke:fence-exists");
        return { ok: true as const };
      },
    });

    await startOrResumeErasure("token", { confirmation: EMAIL }, deps);

    expect(order).toEqual(["revoke:no-fence-yet"]);
    expect(store.documents.has(UID)).toBe(true);
  });

  it("stays resumable (erasure_unavailable) and creates no fence when the revoke cannot be decided", async () => {
    const store = createFakeErasureStore();
    const deps = depsWith({
      port: store,
      handlers: {},
      verifyToken: tokenFor(FRESH_AUTH),
      readFence: noRecordFence,
      revokeSuperadminForErasure: async () => ({ ok: false as const, error: "unavailable" as const }),
    });

    expect(await startOrResumeErasure("token", { confirmation: EMAIL }, deps)).toEqual({
      ok: false,
      error: "erasure_unavailable",
    });
    expect(store.documents.size).toBe(0);
  });
});
