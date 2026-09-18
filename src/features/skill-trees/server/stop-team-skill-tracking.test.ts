import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { SkillProgressDocStore, StopTeamSkillTrackingDeps } from "./stop-team-skill-tracking";
import { stopTeamSkillTracking } from "./stop-team-skill-tracking";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const TEAM_ID = "team-1";
const TREE_ID = "tree-1";

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: ADMIN_UID, email: ADMIN_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

interface FakeProgressStore extends SkillProgressDocStore {
  deletes: string[];
}

function fakeProgressStore(): FakeProgressStore {
  const deletes: string[] = [];
  return {
    deletes,
    async delete(docId) {
      deletes.push(docId);
    },
  };
}

function baseDeps(overrides: Partial<StopTeamSkillTrackingDeps> = {}): StopTeamSkillTrackingDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    progress: fakeProgressStore(),
    ...overrides,
  };
}

describe("stopTeamSkillTracking", () => {
  it("deletes the deterministic progress document for an active team", async () => {
    const progress = fakeProgressStore();

    const result = await stopTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps({ progress }));

    expect(result).toEqual({ ok: true });
    expect(progress.deletes).toEqual([`${TEAM_ID}__${TREE_ID}`]);
  });

  it("succeeds for a disabled team's existing data — this operation has no teams-status-reading or progress-reading seam at all", async () => {
    // StopTeamSkillTrackingDeps has no `teamStatusReader`-shaped field and
    // no read-side of `SkillProgressDocStore` — there is no way for this
    // test (or production code) to make the operation read team status or
    // the existing progress document's content, which is the structural
    // proof BR-16/Owner-decision-5 requires.
    const progress = fakeProgressStore();

    const result = await stopTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps({ progress }));

    expect(result).toEqual({ ok: true });
    expect(progress.deletes).toEqual([`${TEAM_ID}__${TREE_ID}`]);
  });

  it("rejects an unauthenticated caller and attempts no delete", async () => {
    const progress = fakeProgressStore();
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await stopTeamSkillTracking("bad-token", TEAM_ID, TREE_ID, baseDeps({ progress, verifyToken }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(progress.deletes).toHaveLength(0);
  });

  it("rejects a non-admin caller and attempts no delete", async () => {
    const progress = fakeProgressStore();
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await stopTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps({ progress, verifyToken }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(progress.deletes).toHaveLength(0);
  });

  it("is idempotent on a not-currently-tracked pair — a no-op success, not an error", async () => {
    // The fake's `delete` never inspects whether a document existed first —
    // exactly mirroring a real Firestore `delete()` on a nonexistent
    // document, which also resolves successfully.
    const progress = fakeProgressStore();

    const result = await stopTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps({ progress }));

    expect(result).toEqual({ ok: true });
  });

  it("only ever deletes the exact (teamId, treeId) pair's own document, never a different team's or tree's", async () => {
    const progress = fakeProgressStore();

    await stopTeamSkillTracking("token", "team-a", "tree-x", baseDeps({ progress }));

    expect(progress.deletes).toEqual(["team-a__tree-x"]);
    expect(progress.deletes).not.toContain("team-b__tree-x");
    expect(progress.deletes).not.toContain("team-a__tree-y");
  });

  it("introduces no tombstone or replacement record — the store's only capability is delete", async () => {
    const progress = fakeProgressStore();
    expect(Object.keys(progress).filter((key) => key !== "deletes")).toEqual(["delete"]);

    await stopTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps({ progress }));
  });

  it("reports a controlled failure when the delete fails", async () => {
    const progress: SkillProgressDocStore = {
      delete: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await stopTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps({ progress }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never logs on any path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await stopTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps());

    const failingProgress: SkillProgressDocStore = {
      delete: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await stopTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps({ progress: failingProgress }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
