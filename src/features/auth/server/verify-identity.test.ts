import { describe, expect, it, vi } from "vitest";

const verifyIdTokenSpy = vi.fn().mockResolvedValue({
  uid: "user-1",
  email: "dev@example.com",
  email_verified: true,
});

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: verifyIdTokenSpy }),
}));

const { verifyIdToken } = await import("./verify-identity");

describe("verifyIdToken", () => {
  it("returns uid/email/emailVerified extracted from a valid token", async () => {
    const verifyToken = vi.fn().mockResolvedValue({
      uid: "user-1",
      email: "dev@example.com",
      email_verified: true,
    });

    const result = await verifyIdToken("valid-token", { verifyToken });

    expect(result).toEqual({
      ok: true,
      identity: {
        uid: "user-1",
        email: "dev@example.com",
        emailVerified: true,
      },
    });
  });

  it("reports emailVerified as false when the decoded token says so", async () => {
    const verifyToken = vi.fn().mockResolvedValue({
      uid: "user-1",
      email: "dev@example.com",
      email_verified: false,
    });

    const result = await verifyIdToken("valid-token", { verifyToken });

    expect(result).toEqual({
      ok: true,
      identity: {
        uid: "user-1",
        email: "dev@example.com",
        emailVerified: false,
      },
    });
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

    await verifyIdToken("valid-token", {
      verifyToken: vi.fn().mockResolvedValue({
        uid: "user-1",
        email: "dev@example.com",
        email_verified: true,
      }),
    });
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

    await verifyIdToken("valid-token");

    expect(verifyIdTokenSpy).toHaveBeenCalledWith("valid-token", true);
  });
});
