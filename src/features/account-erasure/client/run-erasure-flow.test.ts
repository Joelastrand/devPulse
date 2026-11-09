import { describe, expect, it, vi } from "vitest";
import { MAX_ERASURE_CALLS, runErasureFlow, type ErasureApiResponse, type ErasureClientGateway } from "./run-erasure-flow";

// TASK-039: the client erasure flow with an injected gateway. No Firebase and no network are reached.

const EMAIL = "erased@example.com";
const SIGNED_IN_EMAIL = "erased@example.com";
const PASSWORD = "synthetic-password";

function recordingGateway(responses: ErasureApiResponse[], overrides: Partial<ErasureClientGateway> = {}) {
  const calls: string[] = [];
  const posts: Array<{ token: string; confirmation: string }> = [];
  const gateway: ErasureClientGateway = {
    signedInEmail() {
      calls.push("signedInEmail");
      return SIGNED_IN_EMAIL;
    },
    async reauthenticate(password) {
      calls.push(`reauth:${password.length}`);
    },
    async idToken() {
      calls.push("idToken");
      return "id-token-1";
    },
    async startOrResume(token, confirmation) {
      calls.push("post");
      posts.push({ token, confirmation });
      const next = responses.shift();
      if (next === undefined) throw new Error("no scripted response");
      return next;
    },
    async signOut() {
      calls.push("signOut");
    },
    async wait() {
      calls.push("wait");
    },
    ...overrides,
  };
  return { gateway, calls, posts };
}

describe("runErasureFlow", () => {
  it("refuses an empty e-mail or password before any sign-in or request", async () => {
    const { gateway, calls } = recordingGateway([]);
    expect(await runErasureFlow({ email: " ", password: PASSWORD }, gateway)).toEqual({ ok: false, error: "required" });
    expect(await runErasureFlow({ email: EMAIL, password: "" }, gateway)).toEqual({ ok: false, error: "required" });
    expect(calls).toEqual([]);
  });

  it("re-authenticates the signed-in account before the first POST, and sends the typed e-mail as the confirmation", async () => {
    const { gateway, calls, posts } = recordingGateway([{ status: 200, body: { status: "completed" } }]);

    await runErasureFlow({ email: `  ${EMAIL} `, password: PASSWORD }, gateway);

    expect(calls.indexOf(`reauth:${PASSWORD.length}`)).toBeLessThan(calls.indexOf("post"));
    expect(posts).toEqual([{ token: "id-token-1", confirmation: EMAIL }]);
  });

  it("refuses with unauthenticated, with no sign-in and no request, when no account is signed in", async () => {
    const { gateway, calls } = recordingGateway([], { signedInEmail: () => null });

    expect(await runErasureFlow({ email: EMAIL, password: PASSWORD }, gateway)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(calls).not.toContain(`reauth:${PASSWORD.length}`);
    expect(calls).not.toContain("post");
  });

  it("never passes the typed e-mail to the sign-in: the password re-authenticates the signed-in account only", async () => {
    const reauthenticate = vi.fn(async () => undefined);
    const { gateway } = recordingGateway([{ status: 200, body: { status: "completed" } }], { reauthenticate });

    await runErasureFlow({ email: "other@example.com", password: PASSWORD }, gateway);

    expect(reauthenticate).toHaveBeenCalledWith(PASSWORD);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  it("reports reauthFailed without a request, and without any detail", async () => {
    const { gateway, calls } = recordingGateway([], {
      reauthenticate: async () => {
        throw new Error("auth/wrong-password: internal detail");
      },
    });

    expect(await runErasureFlow({ email: EMAIL, password: PASSWORD }, gateway)).toEqual({ ok: false, error: "reauthFailed" });
    expect(calls).not.toContain("post");
  });

  it("reports unauthenticated when no user token is available after sign-in", async () => {
    const { gateway } = recordingGateway([], { idToken: async () => null });
    expect(await runErasureFlow({ email: EMAIL, password: PASSWORD }, gateway)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });

  it("reads the ID token on every call, so a long resume never relies on one token", async () => {
    const { gateway, calls } = recordingGateway([
      { status: 200, body: { status: "in_progress", step: "forum" } },
      { status: 200, body: { status: "completed" } },
    ]);

    await runErasureFlow({ email: EMAIL, password: PASSWORD }, gateway);

    expect(calls.filter((c) => c === "idToken")).toHaveLength(calls.filter((c) => c === "post").length);
  });

  it("keeps calling while the answer is in_progress, reports progress, and signs out on completed", async () => {
    const { gateway, calls } = recordingGateway([
      { status: 200, body: { status: "in_progress", step: "forum" } },
      { status: 200, body: { status: "in_progress", step: "memberships" } },
      { status: 200, body: { status: "completed" } },
    ]);
    const onProgress = vi.fn();

    expect(await runErasureFlow({ email: EMAIL, password: PASSWORD, onProgress }, gateway)).toEqual({ ok: true });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(calls.filter((c) => c === "post")).toHaveLength(3);
    expect(calls.at(-1)).toBe("signOut");
  });

  it("still reports success when the sign-out after completion fails, without showing its detail", async () => {
    const { gateway } = recordingGateway([{ status: 200, body: { status: "completed" } }], {
      signOut: async () => {
        throw new Error("network detail");
      },
    });
    expect(await runErasureFlow({ email: EMAIL, password: PASSWORD }, gateway)).toEqual({ ok: true });
  });

  it.each([
    [403, { error: "recent_auth_required" }, "recentAuthRequired"],
    [400, { error: "confirmation_mismatch" }, "confirmationMismatch"],
    [503, { error: "erasure_unavailable" }, "unavailable"],
    [401, { error: "unauthenticated" }, "unauthenticated"],
    [409, { error: "last_superadmin" }, "lastSuperadmin"],
    [500, { error: "something internal" }, "generic"],
    [200, { status: "unexpected" }, "generic"],
  ])("maps status %i to the fixed copy key %s without reading any other field", async (status, body, key) => {
    const { gateway } = recordingGateway([{ status, body }]);
    expect(await runErasureFlow({ email: EMAIL, password: PASSWORD }, gateway)).toEqual({ ok: false, error: key });
  });

  it("maps a rejected network call to the generic copy instead of throwing", async () => {
    const { gateway } = recordingGateway([], {
      startOrResume: async () => {
        throw new Error("network down: internal detail");
      },
    });

    expect(await runErasureFlow({ email: EMAIL, password: PASSWORD }, gateway)).toEqual({ ok: false, error: "generic" });
  });

  it("stops after exactly MAX_ERASURE_CALLS calls with unavailable, so a stuck erasure cannot loop forever", async () => {
    const forever = Array.from({ length: MAX_ERASURE_CALLS }, () => ({ status: 200, body: { status: "in_progress", step: "forum" } }));
    const { gateway, calls } = recordingGateway(forever);

    expect(await runErasureFlow({ email: EMAIL, password: PASSWORD }, gateway)).toEqual({ ok: false, error: "unavailable" });
    expect(calls.filter((c) => c === "post")).toHaveLength(MAX_ERASURE_CALLS);
    // The literal bound, so that lowering the constant is also caught.
    expect(calls.filter((c) => c === "post")).toHaveLength(200);
  });
});
