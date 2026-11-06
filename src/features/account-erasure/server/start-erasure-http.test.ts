import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFakeErasureStore } from "./erasure-store-fake";
import {
  bearerTokenFrom,
  isBodyTooLarge,
  START_ERASURE_MAX_BODY_BYTES,
  parseStartErasureBody,
  readStartErasureBody,
  startErasureResponse,
} from "./start-erasure-http";
import type { StartErasureDeps } from "./start-erasure";

const NOW_SECONDS = 1_800_000_000;
const EMAIL = "dev@example.com";
const UID = "uid-a";

function deps(overrides: Partial<StartErasureDeps> & Pick<StartErasureDeps, "port">): StartErasureDeps {
  return {
    handlers: {},
    clockMs: () => 0,
    now: () => new Date(NOW_SECONDS * 1000),
    nowSeconds: () => NOW_SECONDS,
    ready: true,
    verifyToken: vi.fn().mockResolvedValue({
      uid: UID,
      email: EMAIL,
      email_verified: true,
      auth_time: NOW_SECONDS - 10,
    }),
    readFence: async () => ({ kind: "none" as const }),
    revokeSuperadminForErasure: async () => ({ ok: true as const }),
    ...overrides,
  };
}

describe("parseStartErasureBody (body contract)", () => {
  it("accepts an empty object (resume) and an object with a string confirmation (start)", () => {
    expect(parseStartErasureBody({})).toEqual({ ok: true });
    expect(parseStartErasureBody({ confirmation: EMAIL })).toEqual({ ok: true, confirmation: EMAIL });
  });

  it.each([
    ["a uid field", { uid: UID }],
    ["an email field", { email: EMAIL }],
    ["a team field", { teamId: "team-1" }],
    ["a non-string confirmation", { confirmation: 42 }],
    ["an array", []],
    ["null", null],
    ["a string", "confirmation"],
  ])("rejects %s", (_label, raw) => {
    expect(parseStartErasureBody(raw)).toEqual({ ok: false });
  });
});

describe("readStartErasureBody", () => {
  it("treats an empty body as an empty object, so resume needs no body", () => {
    expect(readStartErasureBody("")).toEqual({ ok: true, body: {} });
    expect(readStartErasureBody("   ")).toEqual({ ok: true, body: {} });
  });

  it("rejects text that is not JSON as a request error", () => {
    expect(readStartErasureBody("{not json")).toEqual({ ok: false });
  });
});

describe("isBodyTooLarge", () => {
  it("allows a missing or in-bound Content-Length and rejects one above the bound", () => {
    expect(isBodyTooLarge(null)).toBe(false);
    expect(isBodyTooLarge(String(START_ERASURE_MAX_BODY_BYTES))).toBe(false);
    expect(isBodyTooLarge(String(START_ERASURE_MAX_BODY_BYTES + 1))).toBe(true);
  });
});

describe("bearerTokenFrom", () => {
  it("extracts the bearer token and returns an empty string when none is present", () => {
    expect(bearerTokenFrom("Bearer abc.def")).toBe("abc.def");
    expect(bearerTokenFrom("Basic abc")).toBe("");
    expect(bearerTokenFrom(null)).toBe("");
  });
});

describe("startErasureResponse (HTTP contract)", () => {
  it("returns 503 erasure_unavailable while production is not ready, with no record created", async () => {
    const store = createFakeErasureStore();
    const response = await startErasureResponse("Bearer t", { confirmation: EMAIL }, deps({ port: store, ready: false }));

    expect(response).toEqual({ status: 503, body: { error: "erasure_unavailable" } });
    expect(store.documents.size).toBe(0);
  });

  it("returns 200 with the in-progress state on a successful start", async () => {
    const store = createFakeErasureStore();
    const handlers: StartErasureDeps["handlers"] = {};
    for (const step of ["forum", "memberships", "conversations_owned", "participant_bindings", "locators", "personal_data", "survey_participations", "actor_audit", "verify_data"] as const) {
      handlers[step] = { runBatch: async () => "done" };
    }
    const response = await startErasureResponse("Bearer t", { confirmation: EMAIL }, deps({ port: store, handlers }));

    expect(response).toEqual({ status: 200, body: { status: "in_progress", step: "auth_delete" } });
  });

  it("returns 200 completed for a terminal record, without a restart", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, {
      status: "completed",
      step: "final_sweep",
      startedAt: new Date(NOW_SECONDS * 1000),
      updatedAt: new Date(NOW_SECONDS * 1000),
      completedAt: new Date(NOW_SECONDS * 1000),
      expireAt: new Date(NOW_SECONDS * 1000 + 86_400_000),
    });
    const response = await startErasureResponse("Bearer t", {}, deps({ port: store }));

    expect(response).toEqual({ status: 200, body: { status: "completed" } });
  });

  it("returns 403 recent_auth_required for a stale sign-in, and 400 confirmation_mismatch for a wrong email", async () => {
    const store = createFakeErasureStore();
    const stale = deps({
      port: store,
      verifyToken: vi.fn().mockResolvedValue({ uid: UID, email: EMAIL, email_verified: true, auth_time: NOW_SECONDS - 9_999 }),
    });
    expect(await startErasureResponse("Bearer t", { confirmation: EMAIL }, stale)).toEqual({
      status: 403,
      body: { error: "recent_auth_required" },
    });
    expect(await startErasureResponse("Bearer t", { confirmation: "x@example.com" }, deps({ port: store }))).toEqual({
      status: 400,
      body: { error: "confirmation_mismatch" },
    });
    expect(store.documents.size).toBe(0);
  });

  it("returns 401 invalid_token over HTTP for a terminal record, because the real fence refuses it before the operation", async () => {
    // The fence is the production behaviour: a completed or auth_deleted record is terminal, so verification refuses it.
    const store = createFakeErasureStore();
    const response = await startErasureResponse(
      "Bearer t",
      {},
      deps({ port: store, readFence: async () => ({ kind: "terminal" as const }) }),
    );

    expect(response).toEqual({ status: 401, body: { error: "unauthenticated" } });
    expect(store.documents.size).toBe(0);
  });

  it("returns 401 for a genuine token rejection, and 503 auth_unavailable when the fence read fails", async () => {
    const store = createFakeErasureStore();
    const rejected = deps({ port: store, verifyToken: vi.fn().mockRejectedValue(new Error("bad")) });
    expect(await startErasureResponse("Bearer t", {}, rejected)).toEqual({
      status: 401,
      body: { error: "unauthenticated" },
    });

    const fenceDown = deps({
      port: store,
      readFence: async () => {
        throw new Error("firestore unavailable");
      },
    });
    expect(await startErasureResponse("Bearer t", {}, fenceDown)).toEqual({
      status: 503,
      body: { error: "auth_unavailable" },
    });
  });

  it("returns 503 erasure_unavailable for an operational failure, with no internal detail in the body", async () => {
    const store = createFakeErasureStore();
    store.seed(UID, {
      status: "in_progress",
      step: "forum",
      startedAt: new Date(NOW_SECONDS * 1000 - 60_000),
      updatedAt: new Date(NOW_SECONDS * 1000 - 60_000),
    });
    const failing = deps({
      port: store,
      handlers: {
        forum: {
          runBatch: async () => {
            throw new Error("internal stack detail");
          },
        },
      },
    });

    const response = await startErasureResponse("Bearer t", {}, failing);

    expect(response).toEqual({ status: 503, body: { error: "erasure_unavailable" } });
    expect(JSON.stringify(response.body)).not.toContain("internal");
    expect(JSON.stringify(response.body)).not.toContain(EMAIL);
    expect(JSON.stringify(response.body)).not.toContain(UID);
  });

  it("rejects a body with an extra uid key as invalid_request before any verification", async () => {
    const verifyToken = vi.fn();
    const response = await startErasureResponse(
      "Bearer t",
      { uid: UID, confirmation: EMAIL },
      deps({ port: createFakeErasureStore(), verifyToken }),
    );

    expect(response).toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(verifyToken).not.toHaveBeenCalled();
  });
});
