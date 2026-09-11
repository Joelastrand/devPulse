import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { requireAppAdmin } from "./require-app-admin";

const verifyIdTokenSpy = vi.fn().mockResolvedValue({
  uid: "admin-1",
  email: "admin@example.com",
  email_verified: true,
});

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: verifyIdTokenSpy }),
}));

const ADMIN_EMAIL = "admin@example.com";

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: "admin-1", email: ADMIN_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

describe("requireAppAdmin", () => {
  it("resolves ok with the verified identity for an app admin", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const result = await requireAppAdmin("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
    });

    expect(result).toEqual({ ok: true, identity: verifiedIdentity() });
  });

  it("rejects an unauthenticated caller without checking admin status", async () => {
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await requireAppAdmin("bad-token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("rejects a verified but non-admin caller", async () => {
    const verifyToken = verifyTokenReturning(
      verifiedIdentity({ email: "dev@example.com" }),
    );

    const result = await requireAppAdmin("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("rejects an allow-listed but unverified caller", async () => {
    const verifyToken = verifyTokenReturning(
      verifiedIdentity({ emailVerified: false }),
    );

    const result = await requireAppAdmin("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("checks token revocation by default when no verifyToken override is supplied", async () => {
    verifyIdTokenSpy.mockClear();

    await requireAppAdmin("token", { allowList: [ADMIN_EMAIL] });

    expect(verifyIdTokenSpy).toHaveBeenCalledWith("token", true);
  });

  it("never includes the admin allow-list in the returned result, success or failure", async () => {
    const allowList = [ADMIN_EMAIL, "other-admin@example.com"];

    const okResult = await requireAppAdmin("token", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      allowList,
    });
    const forbiddenResult = await requireAppAdmin("token", {
      verifyToken: verifyTokenReturning(
        verifiedIdentity({ email: "dev@example.com" }),
      ),
      allowList,
    });

    expect(JSON.stringify(okResult)).not.toContain("other-admin@example.com");
    expect(JSON.stringify(forbiddenResult)).not.toContain(
      "other-admin@example.com",
    );
  });

  it("never logs the token or identity for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await requireAppAdmin("token", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      allowList: [ADMIN_EMAIL],
    });
    await requireAppAdmin("bad-token", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      allowList: [ADMIN_EMAIL],
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
