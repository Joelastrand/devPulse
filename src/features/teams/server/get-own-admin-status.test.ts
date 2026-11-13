import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { getOwnAdminStatus } from "./get-own-admin-status";
import { verifierFor } from "../../../../test/auth-fixtures";

const verifyIdTokenSpy = verifierFor({ uid: "user-1", email: "admin@nve.no", emailVerified: true });
const getFirestoreDbMock = vi.fn();

const { testAdminAuth } = await vi.hoisted(async () => await import("../../../../test/auth-fixtures"));
vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => ({ ...testAdminAuth, verifyIdToken: verifyIdTokenSpy }),
  // Deferred (not a direct reference) so the factory object literal doesn't
  // read `getFirestoreDbMock`'s binding before its own `const` initializes
  // — `vi.mock` factories run before the rest of this file's top-level code.
  getFirestoreDb: (...args: unknown[]) => getFirestoreDbMock(...args),
}));

const ADMIN_EMAIL = "admin@nve.no";
const superadmin = async (uid: string) => uid === "user-1";

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: "user-1", email: ADMIN_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return verifierFor({ uid: identity.uid, email: identity.email, emailVerified: identity.emailVerified });
}

describe("getOwnAdminStatus", () => {
  it("returns isAdmin: true for a verified, allow-listed caller", async () => {
    const result = await getOwnAdminStatus("token", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      isSuperadmin: superadmin,
    });

    expect(result).toEqual({ ok: true, isAdmin: true });
  });

  it("returns isAdmin: false for a verified, non-allow-listed caller", async () => {
    const result = await getOwnAdminStatus("token", {
      verifyToken: verifyTokenReturning(verifiedIdentity({ uid: "dev-1", email: "dev@nve.no" })),
      isSuperadmin: superadmin,
    });

    expect(result).toEqual({ ok: true, isAdmin: false });
  });

  it("refuses an allow-listed but unverified-email caller at the identity layer", async () => {
    const result = await getOwnAdminStatus("token", {
      verifyToken: verifyTokenReturning(verifiedIdentity({ emailVerified: false })),
      isSuperadmin: superadmin,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("rejects an unauthenticated/invalid-token caller with a generic error, never a boolean", async () => {
    const result = await getOwnAdminStatus("bad-token", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      isSuperadmin: superadmin,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("returns no field other than isAdmin on success", async () => {
    const result = await getOwnAdminStatus("token", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      isSuperadmin: superadmin,
    });

    expect(result.ok).toBe(true);
    expect(Object.keys(result).sort()).toEqual(["isAdmin", "ok"]);
  });

  it("never includes the admin allow-list in the returned result, success or failure", async () => {
    const isSuperadmin = superadmin;

    const okResult = await getOwnAdminStatus("token", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      isSuperadmin,
    });
    const failResult = await getOwnAdminStatus("bad-token", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      isSuperadmin,
    });

    expect(JSON.stringify(okResult)).not.toContain("other-admin@nve.no");
    expect(JSON.stringify(failResult)).not.toContain("other-admin@nve.no");
  });

  it("performs no Firestore read", async () => {
    await getOwnAdminStatus("token", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      isSuperadmin: superadmin,
    });
    await getOwnAdminStatus("bad-token", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      isSuperadmin: superadmin,
    });

    expect(getFirestoreDbMock).not.toHaveBeenCalled();
  });

  it("checks token revocation by default when no verifyToken override is supplied", async () => {
    verifyIdTokenSpy.mockClear();

    await getOwnAdminStatus("token", { isSuperadmin: superadmin });

    expect(verifyIdTokenSpy).toHaveBeenCalledWith("token", true);
  });

  it("never logs the token or identity for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await getOwnAdminStatus("token", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      isSuperadmin: superadmin,
    });
    await getOwnAdminStatus("bad-token", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      isSuperadmin: superadmin,
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
