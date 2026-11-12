import { describe, expect, it, vi } from "vitest";
import type { AuthGateway } from "./auth-client";
import { observeIdToken, resendVerificationEmail, signIn, signOut, signUp } from "./auth-client";

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
    reloadEmailVerified: vi.fn(async () => true),
    signOut: vi.fn(async () => {
      calls.push("signOut");
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

    const result = await signUp("dev@nve.no", "correct horse battery", {
      gateway,
    });

    expect(result).toEqual({ ok: true });
    expect(gateway.createUser).toHaveBeenCalledWith(
      "dev@nve.no",
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

    const result = await signUp("dev@nve.no", "password", { gateway });

    expect(result).toEqual({ ok: false, error: "sign_up_failed" });
    expect(gateway.sendEmailVerification).not.toHaveBeenCalled();
  });
});

describe("signIn", () => {
  it("succeeds for an existing account", async () => {
    const gateway = fakeGateway();

    const result = await signIn("dev@nve.no", "correct horse battery", {
      gateway,
    });

    expect(result).toEqual({ ok: true });
    expect(gateway.signIn).toHaveBeenCalledWith(
      "dev@nve.no",
      "correct horse battery",
    );
  });

  it("fails for bad credentials", async () => {
    const gateway = fakeGateway({
      signIn: vi.fn(async () => {
        throw new Error("wrong password");
      }),
    });

    const result = await signIn("dev@nve.no", "wrong-password", {
      gateway,
    });

    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
  });
});

describe("signOut", () => {
  it("delegates to the gateway's sign-out call", async () => {
    const gateway = fakeGateway();

    const result = await signOut({ gateway });

    expect(result).toEqual({ ok: true });
    expect(gateway.signOut).toHaveBeenCalled();
  });

  it("reports failure without throwing when the gateway's sign-out call rejects", async () => {
    const gateway = fakeGateway({
      signOut: vi.fn(async () => {
        throw new Error("network error");
      }),
    });

    const result = await signOut({ gateway });

    expect(result).toEqual({ ok: false, error: "sign_out_failed" });
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

describe("NVE sign-up and verification contracts", () => {
  it("refuses a non-NVE address before any account is created", async () => {
    const gateway = fakeGateway();

    const result = await signUp("dev@gmail.com", "correct horse battery", { gateway });

    expect(result).toEqual({ ok: false, error: "not_nve_email" });
    expect(gateway.createUser).not.toHaveBeenCalled();
    expect(gateway.sendEmailVerification).not.toHaveBeenCalled();
  });

  it("refuses a look-alike NVE domain before any account is created", async () => {
    const gateway = fakeGateway();

    const result = await signUp("dev@nve.no.attacker.com", "correct horse battery", { gateway });

    expect(result).toEqual({ ok: false, error: "not_nve_email" });
    expect(gateway.createUser).not.toHaveBeenCalled();
  });

  it("reports an unverified account as email_not_verified rather than invalid credentials", async () => {
    const gateway = fakeGateway({ reloadEmailVerified: vi.fn(async () => false) });

    const result = await signIn("dev@nve.no", "correct horse battery", { gateway });

    expect(result).toEqual({ ok: false, error: "email_not_verified" });
  });

  it("treats a failed verification-state read as unverified (fail closed)", async () => {
    const gateway = fakeGateway({
      reloadEmailVerified: vi.fn(async () => {
        throw new Error("network");
      }),
    });

    const result = await signIn("dev@nve.no", "correct horse battery", { gateway });

    expect(result).toEqual({ ok: false, error: "email_not_verified" });
  });

  it("keeps a wrong password as invalid_credentials", async () => {
    const gateway = fakeGateway({
      signIn: vi.fn(async () => {
        throw new Error("auth/invalid-credential");
      }),
    });

    expect(await signIn("dev@nve.no", "wrong", { gateway })).toEqual({ ok: false, error: "invalid_credentials" });
  });

  it("resends the verification email and reports a generic failure without internal detail", async () => {
    const gateway = fakeGateway();
    expect(await resendVerificationEmail({ gateway })).toEqual({ ok: true });
    expect(gateway.sendEmailVerification).toHaveBeenCalledTimes(1);

    const failing = fakeGateway({
      sendEmailVerification: vi.fn(async () => {
        throw new Error("auth/too-many-requests: internal detail");
      }),
    });
    expect(await resendVerificationEmail({ gateway: failing })).toEqual({ ok: false, error: "resend_failed" });
  });
});
