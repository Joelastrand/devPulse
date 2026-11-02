import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: vi.fn() }),
}));

const { verifyIdToken } = await import("./verify-identity");

const noErasure = async () => ({ kind: "none" as const });

describe("verifyIdToken verifiedAuthTime (account-erasure TASK-010)", () => {
  it("carries the token's auth_time on the verified identity", async () => {
    const verifyToken = vi.fn().mockResolvedValue({
      uid: "user-1",
      email: "dev@example.com",
      email_verified: true,
      auth_time: 1_800_000_000,
    });

    const result = await verifyIdToken("valid-token", { verifyToken, readFence: noErasure });

    expect(result).toEqual({
      ok: true,
      identity: {
        uid: "user-1",
        email: "dev@example.com",
        emailVerified: true,
        verifiedAuthTime: 1_800_000_000,
      },
    });
  });

  it("omits verifiedAuthTime when the decoded token has no auth_time, so other callers see the same shape", async () => {
    const verifyToken = vi.fn().mockResolvedValue({
      uid: "user-1",
      email: "dev@example.com",
      email_verified: true,
    });

    const result = await verifyIdToken("valid-token", { verifyToken, readFence: noErasure });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity).not.toHaveProperty("verifiedAuthTime");
  });
});
