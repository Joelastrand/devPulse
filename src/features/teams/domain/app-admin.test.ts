import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { isAppAdmin } from "./app-admin";

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return {
    uid: "admin-uid",
    email: "admin@example.com",
    emailVerified: true,
    ...overrides,
  };
}

const isSuperadminUid = (...uids: string[]) => async (uid: string) => uids.includes(uid);

describe("isAppAdmin", () => {
  it("returns true for a verified identity whose UID is an active superadmin", async () => {
    await expect(isAppAdmin(identity(), { isSuperadmin: isSuperadminUid("admin-uid") })).resolves.toBe(true);
  });

  it("returns false for a verified identity whose UID is not a superadmin", async () => {
    await expect(isAppAdmin(identity({ uid: "dev-uid" }), { isSuperadmin: isSuperadminUid("admin-uid") })).resolves.toBe(
      false,
    );
  });

  it("keys on the UID, not the email: an email that matches nothing in the registry is never admin", async () => {
    const check = vi.fn(isSuperadminUid("admin-uid"));

    await expect(isAppAdmin(identity({ uid: "dev-uid", email: "admin@example.com" }), { isSuperadmin: check })).resolves.toBe(
      false,
    );
    expect(check).toHaveBeenCalledWith("dev-uid");
  });

  it("never grants admin to an unverified email, even for an active superadmin UID", async () => {
    const check = vi.fn(isSuperadminUid("admin-uid"));

    await expect(isAppAdmin(identity({ emailVerified: false }), { isSuperadmin: check })).resolves.toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it("ignores client-supplied role flags on the identity object", async () => {
    const spoofed = { ...identity({ uid: "dev-uid" }), isAdmin: true, role: "superadmin" };

    await expect(isAppAdmin(spoofed, { isSuperadmin: isSuperadminUid("admin-uid") })).resolves.toBe(false);
  });

  it("propagates a registry read failure so the caller fails closed", async () => {
    const failing = async () => {
      throw new Error("firestore unavailable");
    };

    await expect(isAppAdmin(identity(), { isSuperadmin: failing })).rejects.toThrow("firestore unavailable");
  });
});
