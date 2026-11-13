import { describe, expect, it, vi } from "vitest";
import { issueErasureResumeCapability } from "./erasure-resume-capability";
import type { LiveAccount } from "./verify-identity";

// Focused boundary tests for the NVE access policy and the account-erasure exception. Other boundaries are covered where
// they live: team membership (authorize-team-access.test.ts), team-admin refusals (teams/server/*.test.ts), owner isolation
// (app/api/me/skills/owner-isolation.test.ts), and the identity policy (verify-identity.test.ts).

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: vi.fn(), getUser: vi.fn() }),
}));

const { verifyIdToken } = await import("./verify-identity");

const noErasure = async () => ({ kind: "none" as const });
const notSuperadmin = async () => false;

function account(overrides: Partial<LiveAccount> = {}): LiveAccount {
  return { uid: "person-1", email: "person@gmail.com", emailVerified: true, disabled: false, ...overrides };
}

const tokenFor = (uid: string, email: string) =>
  vi.fn().mockResolvedValue({ uid, email, email_verified: true });

describe("account-erasure exception to the NVE policy", () => {
  it("lets a verified person who is no longer NVE-eligible resume their own erasure through the capability", async () => {
    const result = await verifyIdToken("token", {
      verifyToken: tokenFor("person-1", "person@gmail.com"),
      readFence: noErasure,
      loadAccount: async () => account(),
      isSuperadmin: notSuperadmin,
      allowDuringErasure: issueErasureResumeCapability(),
    });

    expect(result).toEqual({
      ok: true,
      identity: { uid: "person-1", email: "person@gmail.com", emailVerified: true },
    });
  });

  it("does not turn the capability into general access: the same non-NVE person is refused without it", async () => {
    const result = await verifyIdToken("token", {
      verifyToken: tokenFor("person-1", "person@gmail.com"),
      readFence: noErasure,
      loadAccount: async () => account(),
      isSuperadmin: notSuperadmin,
    });

    expect(result).toEqual({ ok: false, error: "invalid_token" });
  });

  it("keeps the verification requirement on the erasure path: an unverified person cannot resume", async () => {
    const result = await verifyIdToken("token", {
      verifyToken: tokenFor("person-1", "person@gmail.com"),
      readFence: noErasure,
      loadAccount: async () => account({ emailVerified: false }),
      isSuperadmin: notSuperadmin,
      allowDuringErasure: issueErasureResumeCapability(),
    });

    expect(result).toEqual({ ok: false, error: "invalid_token" });
  });

  it("keeps the disabled check on the erasure path: a disabled account cannot resume", async () => {
    const result = await verifyIdToken("token", {
      verifyToken: tokenFor("person-1", "person@gmail.com"),
      readFence: noErasure,
      loadAccount: async () => account({ disabled: true }),
      isSuperadmin: notSuperadmin,
      allowDuringErasure: issueErasureResumeCapability(),
    });

    expect(result).toEqual({ ok: false, error: "invalid_token" });
  });
});

describe("protected access for an active Gmail superadmin", () => {
  it("admits a verified Gmail account only when the registry (by UID) says it is superadmin", async () => {
    const asSuperadmin = await verifyIdToken("token", {
      verifyToken: tokenFor("owner-1", "owner@gmail.com"),
      readFence: noErasure,
      loadAccount: async () => account({ uid: "owner-1", email: "owner@gmail.com" }),
      isSuperadmin: async (uid) => uid === "owner-1",
    });
    const sameEmailOtherUid = await verifyIdToken("token", {
      verifyToken: tokenFor("other-1", "owner@gmail.com"),
      readFence: noErasure,
      loadAccount: async () => account({ uid: "other-1", email: "owner@gmail.com" }),
      isSuperadmin: async (uid) => uid === "owner-1",
    });

    expect(asSuperadmin.ok).toBe(true);
    expect(sameEmailOtherUid).toEqual({ ok: false, error: "invalid_token" });
  });
});
