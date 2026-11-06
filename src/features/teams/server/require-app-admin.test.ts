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
const superadmin = async (uid: string) => uid === "admin-1";

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
      isSuperadmin: superadmin,
    });

    expect(result).toEqual({ ok: true, identity: verifiedIdentity() });
  });

  it("rejects an unauthenticated caller without checking admin status", async () => {
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await requireAppAdmin("bad-token", {
      verifyToken,
      isSuperadmin: superadmin,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("rejects a verified but non-admin caller", async () => {
    const verifyToken = verifyTokenReturning(
      verifiedIdentity({ uid: "dev-1", email: "dev@example.com" }),
    );

    const result = await requireAppAdmin("token", {
      verifyToken,
      isSuperadmin: superadmin,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("rejects an allow-listed but unverified caller", async () => {
    const verifyToken = verifyTokenReturning(
      verifiedIdentity({ emailVerified: false }),
    );

    const result = await requireAppAdmin("token", {
      verifyToken,
      isSuperadmin: superadmin,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("checks token revocation by default when no verifyToken override is supplied", async () => {
    verifyIdTokenSpy.mockClear();

    await requireAppAdmin("token", { isSuperadmin: superadmin });

    expect(verifyIdTokenSpy).toHaveBeenCalledWith("token", true);
  });

  it("never includes the admin allow-list in the returned result, success or failure", async () => {
    const isSuperadmin = superadmin;

    const okResult = await requireAppAdmin("token", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      isSuperadmin,
    });
    const forbiddenResult = await requireAppAdmin("token", {
      verifyToken: verifyTokenReturning(
        verifiedIdentity({ uid: "dev-1", email: "dev@example.com" }),
      ),
      isSuperadmin,
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
      isSuperadmin: superadmin,
    });
    await requireAppAdmin("bad-token", {
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
