import { describe, expect, it, vi } from "vitest";
import { decideAccess } from "../server/access-policy";

const nobody = vi.fn(async () => false);

describe("decideAccess (NVE access policy)", () => {
  it("allows a verified NVE account without reading the superadmin registry", async () => {
    const isSuperadmin = vi.fn(nobody);
    const decision = await decideAccess({ uid: "u1", email: "employee@nve.no", emailVerified: true }, isSuperadmin);

    expect(decision).toEqual({ allowed: true, basis: "nve_email" });
    expect(isSuperadmin).not.toHaveBeenCalled();
  });

  it("refuses an unverified NVE address, even for a registered superadmin", async () => {
    const decision = await decideAccess({ uid: "u1", email: "employee@nve.no", emailVerified: false }, async () => true);

    expect(decision).toEqual({ allowed: false, reason: "email_not_verified" });
  });

  it("refuses a verified non-NVE account that is not an active superadmin", async () => {
    const decision = await decideAccess({ uid: "u2", email: "person@gmail.com", emailVerified: true }, nobody);

    expect(decision).toEqual({ allowed: false, reason: "email_domain_not_allowed" });
  });

  it("admits a verified non-NVE address only through the registry, keyed by uid", async () => {
    const isSuperadmin = vi.fn(async (uid: string) => uid === "owner-uid");

    const owner = await decideAccess({ uid: "owner-uid", email: "owner@gmail.com", emailVerified: true }, isSuperadmin);
    const other = await decideAccess({ uid: "other-uid", email: "owner@gmail.com", emailVerified: true }, isSuperadmin);

    expect(owner).toEqual({ allowed: true, basis: "superadmin" });
    expect(other).toEqual({ allowed: false, reason: "email_domain_not_allowed" });
  });

  it("propagates a registry read failure so the caller fails closed", async () => {
    await expect(
      decideAccess({ uid: "u2", email: "person@gmail.com", emailVerified: true }, async () => {
        throw new Error("registry down");
      }),
    ).rejects.toThrow("registry down");
  });
});
