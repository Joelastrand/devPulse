import { describe, expect, it, vi } from "vitest";
import { createFakeErasureStore } from "./erasure-store-fake";
import { PRODUCTION_HANDLERS_READY, getProductionStartErasureDeps } from "./production-erasure";
import { startErasureResponse } from "./start-erasure-http";

// The production chain is wired (TASK-038). These tests do not reach Firebase: they check the flag, the composition and the
// refusal paths that never touch a service. The real chain is exercised over the Admin recording double in
// erasure-end-to-end.test.ts.

const EMAIL = "erased@example.com";
const UID = "uid-a";

describe("production erasure readiness gate (TASK-013, TASK-038)", () => {
  it("is ready: the complete production chain is wired, and the D-EMU race evidence is recorded (VERIFICATION.md)", () => {
    expect(PRODUCTION_HANDLERS_READY).toBe(true);

    const deps = getProductionStartErasureDeps({ port: createFakeErasureStore() });

    expect(deps.ready).toBe(true);
    expect(deps.handlersFor).toBeTypeOf("function");
    expect(deps.authDeletion).toBeTypeOf("function");
  });

  it("still refuses a mismatched confirmation before any record or step, with no service call", async () => {
    const store = createFakeErasureStore();
    const deps = getProductionStartErasureDeps({
      port: store,
      verifyToken: vi.fn().mockResolvedValue({
        uid: UID,
        email: EMAIL,
        email_verified: true,
        // The production dependencies read the real clock, so the sign-in must be fresh against Date.now().
        auth_time: Math.floor(Date.now() / 1000) - 10,
      }),
      readFence: async () => ({ kind: "none" as const }),
    });

    const response = await startErasureResponse("Bearer t", { confirmation: "someone-else@example.com" }, deps);

    expect(response).toEqual({ status: 400, body: { error: "confirmation_mismatch" } });
    expect(store.documents.size).toBe(0);
  });

  it("the handler map is per request: the static map stays empty, so only the verified identity can build the chain", () => {
    const deps = getProductionStartErasureDeps({ port: createFakeErasureStore() });

    expect(deps.handlers).toEqual({});
  });
});
