import { describe, expect, it, vi } from "vitest";
import { issueErasureResumeCapability, type ErasureResumeCapability } from "./erasure-resume-capability";
import { verifyIdToken } from "./verify-identity";

// The fence reader is injected in every case here, which overrides the setup default (no record) per test.
const decoded = { uid: "uid-a", email: "dev@example.com", email_verified: true };
const noRecord = async () => ({ kind: "none" as const });

describe("verifyIdToken fence branches (injected reader)", () => {
  it("keeps genuine rejection on the invalid_token path, with no fence read", async () => {
    const readFence = vi.fn(noRecord);
    const result = await verifyIdToken("token", {
      verifyToken: vi.fn().mockRejectedValue(Object.assign(new Error("revoked"), { code: "auth/id-token-revoked" })),
      readFence,
    });
    expect(result).toEqual({ ok: false, error: "invalid_token" });
    expect(readFence).not.toHaveBeenCalled();
  });

  it("maps Auth infrastructure failures to auth_unavailable, never to invalid_token", async () => {
    for (const code of ["auth/internal-error", "app/network-timeout", "auth/service-unavailable"]) {
      const result = await verifyIdToken("token", {
        verifyToken: vi.fn().mockRejectedValue(Object.assign(new Error("down"), { code })),
        readFence: noRecord,
      });
      expect(result).toEqual({ ok: false, error: "auth_unavailable" });
    }
  });

  it("looks up the fence by the verified uid, after verification", async () => {
    const readFence = vi.fn(noRecord);
    await verifyIdToken("token", { verifyToken: vi.fn().mockResolvedValue(decoded), readFence });
    expect(readFence).toHaveBeenCalledWith("uid-a");
  });

  it("returns the unchanged identity shape when there is no record", async () => {
    const result = await verifyIdToken("token", { verifyToken: vi.fn().mockResolvedValue(decoded), readFence: noRecord });
    expect(result).toEqual({
      ok: true,
      identity: { uid: "uid-a", email: "dev@example.com", emailVerified: true },
    });
  });

  it("refuses in-progress with erasure_in_progress unless an issued resume capability is passed", async () => {
    const inProgress = async () => ({ kind: "in_progress" as const });
    const verifyToken = vi.fn().mockResolvedValue(decoded);
    expect(await verifyIdToken("token", { verifyToken, readFence: inProgress })).toEqual({
      ok: false,
      error: "erasure_in_progress",
    });
    // A plain object cannot stand in for the capability: it is refused at runtime, even under a cast.
    const forged = {} as unknown as ErasureResumeCapability;
    expect(await verifyIdToken("token", { verifyToken, readFence: inProgress, allowDuringErasure: forged })).toEqual({
      ok: false,
      error: "erasure_in_progress",
    });
    expect(await verifyIdToken("token", { verifyToken, readFence: inProgress, allowDuringErasure: issueErasureResumeCapability() })).toEqual({
      ok: true,
      identity: { uid: "uid-a", email: "dev@example.com", emailVerified: true },
    });
  });

  it("maps a malformed record and a failed fence read to auth_unavailable, with no detail leaked", async () => {
    const verifyToken = vi.fn().mockResolvedValue(decoded);
    expect(await verifyIdToken("token", { verifyToken, readFence: async () => ({ kind: "malformed" as const }) })).toEqual({
      ok: false,
      error: "auth_unavailable",
    });
    expect(
      await verifyIdToken("token", {
        verifyToken,
        readFence: async () => {
          throw new Error("secret detail");
        },
      }),
    ).toEqual({ ok: false, error: "auth_unavailable" });
  });

  it("keeps the email requirement ahead of the fence", async () => {
    const readFence = vi.fn(noRecord);
    const result = await verifyIdToken("token", {
      verifyToken: vi.fn().mockResolvedValue({ uid: "uid-a", email_verified: true }),
      readFence,
    });
    expect(result).toEqual({ ok: false, error: "invalid_token" });
    expect(readFence).not.toHaveBeenCalled();
  });
});
