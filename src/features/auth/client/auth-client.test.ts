import { describe, expect, it, vi } from "vitest";
import type { AuthGateway } from "./auth-client";
import { observeIdToken, signIn, signUp } from "./auth-client";

function fakeGateway(overrides: Partial<AuthGateway> = {}): AuthGateway & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    createUser: vi.fn(async () => {
      calls.push("createUser");
    }),
    sendEmailVerification: vi.fn(async () => {
      calls.push("sendEmailVerification");
    }),
    signIn: vi.fn(async () => {
      calls.push("signIn");
    }),
    subscribeToIdToken: vi.fn(() => () => {
      calls.push("unsubscribe");
    }),
    ...overrides,
  };
}

describe("signUp", () => {
  it("creates an account and triggers a verification email send", async () => {
    const gateway = fakeGateway();

    const result = await signUp("dev@example.com", "correct horse battery", {
      gateway,
    });

    expect(result).toEqual({ ok: true });
    expect(gateway.createUser).toHaveBeenCalledWith(
      "dev@example.com",
      "correct horse battery",
    );
    expect(gateway.sendEmailVerification).toHaveBeenCalled();
    expect(gateway.calls).toEqual(["createUser", "sendEmailVerification"]);
  });

  it("reports failure and never attempts to send a verification email when account creation fails", async () => {
    const gateway = fakeGateway({
      createUser: vi.fn(async () => {
        throw new Error("email already in use");
      }),
    });

    const result = await signUp("dev@example.com", "password", { gateway });

    expect(result).toEqual({ ok: false, error: "sign_up_failed" });
    expect(gateway.sendEmailVerification).not.toHaveBeenCalled();
  });
});

describe("signIn", () => {
  it("succeeds for an existing account", async () => {
    const gateway = fakeGateway();

    const result = await signIn("dev@example.com", "correct horse battery", {
      gateway,
    });

    expect(result).toEqual({ ok: true });
    expect(gateway.signIn).toHaveBeenCalledWith(
      "dev@example.com",
      "correct horse battery",
    );
  });

  it("fails for bad credentials", async () => {
    const gateway = fakeGateway({
      signIn: vi.fn(async () => {
        throw new Error("wrong password");
      }),
    });

    const result = await signIn("dev@example.com", "wrong-password", {
      gateway,
    });

    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
  });
});

describe("observeIdToken", () => {
  it("delegates to the gateway's subscription and forwards token updates", () => {
    let emit: (token: string | null) => void = () => {};
    const gateway = fakeGateway({
      subscribeToIdToken: vi.fn((callback) => {
        emit = callback;
        return () => {};
      }),
    });

    const callback = vi.fn();
    observeIdToken(callback, { gateway });

    emit("an-id-token");
    expect(callback).toHaveBeenCalledWith("an-id-token");

    emit(null);
    expect(callback).toHaveBeenCalledWith(null);
  });

  it("returns an unsubscribe function delegating to the gateway", () => {
    const gateway = fakeGateway();

    const unsubscribe = observeIdToken(vi.fn(), { gateway });
    unsubscribe();

    expect(gateway.calls).toEqual(["unsubscribe"]);
  });
});
