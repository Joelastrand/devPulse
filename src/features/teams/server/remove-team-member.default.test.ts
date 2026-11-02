import { describe, expect, it, vi } from "vitest";

// TASK-038 I-3: the production default of removeTeamMember routes through the membership-destruction boundary, with the
// membership id built from (uid, teamId). The adapter is mocked at the module boundary; its own tests cover the Firestore calls.

const destroy = vi.hoisted(() => vi.fn(async () => "done" as const));
vi.mock("../../account-erasure/server/membership-destruction-adapter", () => ({
  destroyMembershipForRemoval: destroy,
}));
vi.mock("server-only", () => ({}));

import { membershipDocId } from "../domain/team-membership";
import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import { removeTeamMember } from "./remove-team-member";

const ADMIN_EMAIL = "admin@example.com";
const verifyToken = vi.fn().mockResolvedValue({ uid: "admin-1", email: ADMIN_EMAIL, email_verified: true });

describe("removeTeamMember: production default", () => {
  it("destroys the membership of (uid, teamId) through the membership-destruction boundary, not a plain delete", async () => {
    destroy.mockClear();

    const result = await removeTeamMember("token", "team-1", "member-1", { verifyToken, allowList: [ADMIN_EMAIL] });

    expect(result).toEqual({ ok: true });
    // The fence subject is the member being removed (the target), not the admin who asked.
    expect(destroy).toHaveBeenCalledWith("member-1", membershipDocId("member-1", "team-1"));
    expect(destroy).not.toHaveBeenCalledWith("admin-1", expect.anything());
  });

  it("refuses a non-admin before any destruction, so the boundary is never reached", async () => {
    destroy.mockClear();

    const result = await removeTeamMember("token", "team-1", "member-1", {
      verifyToken: vi.fn().mockResolvedValue({ uid: "someone", email: "x@example.com", email_verified: true }),
      allowList: [ADMIN_EMAIL],
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(destroy).not.toHaveBeenCalled();
  });

  it("refuses with erasure_in_progress when the removed member's erasure fence refuses the destruction", async () => {
    destroy.mockRejectedValueOnce(new ErasureWriteRefused());

    const result = await removeTeamMember("token", "team-1", "member-1", { verifyToken, allowList: [ADMIN_EMAIL] });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
  });

  it("reports a failed destruction as persistence_failed, without the raw error", async () => {
    destroy.mockRejectedValueOnce(new Error("binding_inconsistent for owner-secret"));

    const result = await removeTeamMember("token", "team-1", "member-1", { verifyToken, allowList: [ADMIN_EMAIL] });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("owner-secret");
  });
});
