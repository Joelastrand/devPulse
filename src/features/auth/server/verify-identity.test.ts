import { describe, expect, it, vi } from "vitest";
import type { DecodedIdToken } from "firebase-admin/auth";

const verifyIdTokenSpy = vi.fn().mockResolvedValue({
  uid: "user-1",
  email: "dev@nve.no",
  email_verified: true,
});

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: verifyIdTokenSpy }),
}));

const { verifyIdToken } = await import("./verify-identity");

const noErasure = async () => ({ kind: "none" as const });
const notSuperadmin = async () => false;

/** A live Firebase Auth account. Tests override fields to model a disabled, unverified or re-addressed account. */
function liveAccount(overrides: Partial<{ email: string; emailVerified: boolean; disabled: boolean }> = {}) {
  return {
    uid: "user-1",
    email: "dev@nve.no",
    emailVerified: true,
    disabled: false,
    ...overrides,
  };
}

const deps = (verifyToken: (token: string) => Promise<unknown>, account = liveAccount(), isSuperadmin = notSuperadmin) => ({
  // Test doubles resolve a decoded-token-shaped object; the cast is confined to this fixture.
  verifyToken: (token: string) => verifyToken(token) as Promise<DecodedIdToken>,
  readFence: noErasure,
  loadAccount: async () => account,
  isSuperadmin,
});

describe("verifyIdToken", () => {
  it("returns uid, email and emailVerified from the live account for a valid NVE token", async () => {
    const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "dev@nve.no", email_verified: true });

    const result = await verifyIdToken("valid-token", deps(verifyToken));

    expect(result).toEqual({
      ok: true,
      identity: { uid: "user-1", email: "dev@nve.no", emailVerified: true },
    });
  });

  it("takes the verification flag from the live account, not from the token", async () => {
    const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "dev@nve.no", email_verified: true });

    const result = await verifyIdToken("valid-token", deps(verifyToken, liveAccount({ emailVerified: false })));

    expect(result).toEqual({ ok: false, error: "invalid_token" });
  });

  it("uses the live account email, so a token with a stale non-NVE address does not grant access", async () => {
    const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "dev@nve.no", email_verified: true });

    const result = await verifyIdToken("valid-token", deps(verifyToken, liveAccount({ email: "dev@gmail.com" })));

    expect(result).toEqual({ ok: false, error: "invalid_token" });
  });

  it("rejects a disabled live account even when the token itself is still valid", async () => {
    const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "dev@nve.no", email_verified: true });

    const result = await verifyIdToken("valid-token", deps(verifyToken, liveAccount({ disabled: true })));

    expect(result).toEqual({ ok: false, error: "invalid_token" });
  });

  it("rejects a verified @nve.no-looking domain that is only a prefix or suffix match", async () => {
    const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "x@nve.no.attacker.com", email_verified: true });

    const result = await verifyIdToken(
      "valid-token",
      deps(verifyToken, liveAccount({ email: "x@nve.no.attacker.com" })),
    );

    expect(result).toEqual({ ok: false, error: "invalid_token" });
  });

  it("admits a verified non-NVE account only when the registry says it is an active superadmin", async () => {
    const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "owner@gmail.com", email_verified: true });
    const account = liveAccount({ email: "owner@gmail.com" });

    const asSuperadmin = await verifyIdToken("valid-token", deps(verifyToken, account, async () => true));
    const asOrdinary = await verifyIdToken("valid-token", deps(verifyToken, account, async () => false));

    expect(asSuperadmin).toEqual({
      ok: true,
      identity: { uid: "user-1", email: "owner@gmail.com", emailVerified: true },
    });
    expect(asOrdinary).toEqual({ ok: false, error: "invalid_token" });
  });

  it("fails closed when the superadmin registry cannot be read for a non-NVE account", async () => {
    const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "owner@gmail.com", email_verified: true });

    const result = await verifyIdToken(
      "valid-token",
      deps(verifyToken, liveAccount({ email: "owner@gmail.com" }), async () => {
        throw new Error("registry unavailable");
      }),
    );

    expect(result).toEqual({ ok: false, error: "auth_unavailable" });
  });

  it("does not read the superadmin registry for an ordinary NVE account", async () => {
    const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "dev@nve.no", email_verified: true });
    const isSuperadmin = vi.fn(notSuperadmin);

    await verifyIdToken("valid-token", deps(verifyToken, liveAccount(), isSuperadmin));

    expect(isSuperadmin).not.toHaveBeenCalled();
  });

  it("treats a missing live account as a rejection", async () => {
    const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "dev@nve.no", email_verified: true });

    const result = await verifyIdToken("valid-token", {
      verifyToken,
      readFence: noErasure,
      loadAccount: async () => {
        throw Object.assign(new Error("gone"), { code: "auth/user-not-found" });
      },
    });

    expect(result).toEqual({ ok: false, error: "invalid_token" });
  });

  it("maps any other live-account read failure to auth_unavailable", async () => {
    const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "dev@nve.no", email_verified: true });

    const result = await verifyIdToken("valid-token", {
      verifyToken,
      readFence: noErasure,
      loadAccount: async () => {
        throw new Error("network down");
      },
    });

    expect(result).toEqual({ ok: false, error: "auth_unavailable" });
  });

  it("rejects when the underlying token verification throws", async () => {
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await verifyIdToken("malformed-token", { verifyToken });

    expect(result).toEqual({ ok: false, error: "invalid_token" });
  });

  it("rejects a missing/empty token without attempting verification", async () => {
    const verifyToken = vi.fn();

    const result = await verifyIdToken("", { verifyToken });

    expect(result).toEqual({ ok: false, error: "invalid_token" });
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it("rejects a decoded token with no email", async () => {
    const verifyToken = vi.fn().mockResolvedValue({
      uid: "user-1",
      email_verified: true,
    });

    const result = await verifyIdToken("valid-token", { verifyToken });

    expect(result).toEqual({ ok: false, error: "invalid_token" });
  });

  it("never logs the token or decoded claims for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await verifyIdToken(
      "valid-token",
      deps(
        vi.fn().mockResolvedValue({
          uid: "user-1",
          email: "dev@nve.no",
          email_verified: true,
        }),
      ),
    );
    await verifyIdToken("bad-token", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("checks token revocation by default so a revoked/disabled session is rejected before its natural expiry", async () => {
    verifyIdTokenSpy.mockClear();

    await verifyIdToken("valid-token", { readFence: noErasure, loadAccount: async () => liveAccount() });

    expect(verifyIdTokenSpy).toHaveBeenCalledWith("valid-token", true);
  });
});
