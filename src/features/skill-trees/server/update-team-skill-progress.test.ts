import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type {
  SkillProgressDocStore,
  SkillTreeReader,
  UpdateTeamSkillProgressDeps,
  UpdateTeamSkillProgressDocSnapshot,
} from "./update-team-skill-progress";
import { updateTeamSkillProgress } from "./update-team-skill-progress";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const TEAM_ID = "team-1";
const TREE_ID = "tree-1";
const NOW = new Date("2026-09-01T00:00:00Z");

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

function validProgressData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    treeId: TREE_ID,
    currentNodeId: "node-0",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    updatedBy: "original-admin",
    ...overrides,
  };
}

function validTreeData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Container adoption",
    nodes: [
      { nodeId: "node-0", label: "Container fundamentals", order: 0 },
      { nodeId: "node-1", label: "Evaluate alternatives", order: 1 },
      { nodeId: "node-2", label: "Build competence", order: 2 },
    ],
    createdAt: new Date("2025-01-01T00:00:00Z"),
    createdBy: "original-admin",
    ...overrides,
  };
}

interface FakeProgressStore extends SkillProgressDocStore {
  updates: { docId: string; data: Record<string, unknown> }[];
}

function fakeProgressStore(data: Record<string, unknown> | undefined): FakeProgressStore {
  const updates: { docId: string; data: Record<string, unknown> }[] = [];
  return {
    updates,
    async get(): Promise<UpdateTeamSkillProgressDocSnapshot> {
      return { exists: data !== undefined, data: () => data };
    },
    async update(docId, updateData) {
      updates.push({ docId, data: updateData });
    },
  };
}

function fakeTreeReader(data: Record<string, unknown> | undefined): SkillTreeReader {
  return {
    async get(): Promise<UpdateTeamSkillProgressDocSnapshot> {
      return { exists: data !== undefined, data: () => data };
    },
  };
}

function baseDeps(overrides: Partial<UpdateTeamSkillProgressDeps> = {}): UpdateTeamSkillProgressDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    progress: fakeProgressStore(validProgressData()),
    treeReader: fakeTreeReader(validTreeData()),
    now: NOW,
    ...overrides,
  };
}

describe("updateTeamSkillProgress", () => {
  it("moves the current stage forward, persisting exactly the approved field set", async () => {
    const progress = fakeProgressStore(validProgressData());

    const result = await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

    expect(result).toEqual({ ok: true });
    expect(progress.updates).toEqual([
      {
        docId: `${TEAM_ID}__${TREE_ID}`,
        data: { currentNodeId: "node-1", updatedAt: NOW, updatedBy: ADMIN_UID },
      },
    ]);
  });

  it("moves the current stage backward — no monotonicity constraint (BR-13)", async () => {
    const progress = fakeProgressStore(validProgressData({ currentNodeId: "node-2" }));

    const result = await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-0", baseDeps({ progress }));

    expect(result).toEqual({ ok: true });
    expect(progress.updates[0].data.currentNodeId).toBe("node-0");
  });

  it("rejects an unauthenticated caller and attempts no write", async () => {
    const progress = fakeProgressStore(validProgressData());
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await updateTeamSkillProgress(
      "bad-token",
      TEAM_ID,
      TREE_ID,
      "node-1",
      baseDeps({ progress, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(progress.updates).toHaveLength(0);
  });

  it("rejects a non-admin caller and attempts no write", async () => {
    const progress = fakeProgressStore(validProgressData());
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await updateTeamSkillProgress(
      "token",
      TEAM_ID,
      TREE_ID,
      "node-1",
      baseDeps({ progress, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(progress.updates).toHaveLength(0);
  });

  it("rejects a not-yet-tracked pair with not_tracked and attempts no write", async () => {
    const progress = fakeProgressStore(undefined);

    const result = await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

    expect(result).toEqual({ ok: false, error: "not_tracked" });
    expect(progress.updates).toHaveLength(0);
  });

  it("fails closed with not_tracked on a malformed persisted progress document, never normalizing it", async () => {
    const progress = fakeProgressStore({ teamId: TEAM_ID, treeId: TREE_ID }); // missing currentNodeId/updatedAt/updatedBy

    const result = await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

    expect(result).toEqual({ ok: false, error: "not_tracked" });
    expect(progress.updates).toHaveLength(0);
  });

  it("fails closed with not_tracked when the persisted teamId does not match the requested scope", async () => {
    const progress = fakeProgressStore(validProgressData({ teamId: "some-other-team" }));

    const result = await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

    expect(result).toEqual({ ok: false, error: "not_tracked" });
    expect(progress.updates).toHaveLength(0);
  });

  it("fails closed with not_tracked when the persisted treeId does not match the requested scope", async () => {
    const progress = fakeProgressStore(validProgressData({ treeId: "some-other-tree" }));

    const result = await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

    expect(result).toEqual({ ok: false, error: "not_tracked" });
    expect(progress.updates).toHaveLength(0);
  });

  it("rejects a nodeId foreign to the target tree with invalid_input and attempts no write", async () => {
    const progress = fakeProgressStore(validProgressData());

    const result = await updateTeamSkillProgress(
      "token",
      TEAM_ID,
      TREE_ID,
      "node-from-another-tree",
      baseDeps({ progress }),
    );

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(progress.updates).toHaveLength(0);
  });

  it("rejects a non-string nodeId with invalid_input and attempts no write", async () => {
    const progress = fakeProgressStore(validProgressData());

    const result = await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, 42, baseDeps({ progress }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(progress.updates).toHaveLength(0);
  });

  it("returns tree_not_found when the referenced tree no longer resolves (defensive)", async () => {
    const progress = fakeProgressStore(validProgressData());

    const result = await updateTeamSkillProgress(
      "token",
      TEAM_ID,
      TREE_ID,
      "node-1",
      baseDeps({ progress, treeReader: fakeTreeReader(undefined) }),
    );

    expect(result).toEqual({ ok: false, error: "tree_not_found" });
    expect(progress.updates).toHaveLength(0);
  });

  it("fails closed with tree_not_found on a malformed referenced tree document", async () => {
    const progress = fakeProgressStore(validProgressData());

    const result = await updateTeamSkillProgress(
      "token",
      TEAM_ID,
      TREE_ID,
      "node-1",
      baseDeps({ progress, treeReader: fakeTreeReader({ name: "Container adoption" }) }),
    );

    expect(result).toEqual({ ok: false, error: "tree_not_found" });
    expect(progress.updates).toHaveLength(0);
  });

  it("succeeds against a disabled team's existing data — this operation has no teams-status-reading seam at all", async () => {
    // UpdateTeamSkillProgressDeps has no `teamStatusReader`-shaped field —
    // there is no way for this test (or production code) to make the
    // operation read team status even if it wanted to, which is the
    // structural proof BR-16/Owner-decision-5 requires.
    const progress = fakeProgressStore(validProgressData());

    const result = await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-2", baseDeps({ progress }));

    expect(result).toEqual({ ok: true });
  });

  it("ignores a request-shaped teamId/treeId/updatedBy override since the function signature has no body parameter for them", async () => {
    const progress = fakeProgressStore(validProgressData());
    const identity = verifiedIdentity({ uid: "admin-2", email: "second-admin@example.com" });

    await updateTeamSkillProgress(
      "token",
      TEAM_ID,
      TREE_ID,
      "node-1",
      baseDeps({
        progress,
        verifyToken: verifyTokenReturning(identity),
        allowList: [ADMIN_EMAIL, "second-admin@example.com"],
      }),
    );

    expect(progress.updates[0].data.updatedBy).toBe("admin-2");
    expect(Object.keys(progress.updates[0].data)).toEqual(["currentNodeId", "updatedAt", "updatedBy"]);
  });

  it("reports a controlled failure when reading progress fails", async () => {
    const progress: SkillProgressDocStore = {
      get: vi.fn().mockRejectedValue(new Error("simulated outage")),
      update: vi.fn(),
    };

    const result = await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure when reading the tree fails", async () => {
    const progress = fakeProgressStore(validProgressData());
    const treeReader: SkillTreeReader = { get: vi.fn().mockRejectedValue(new Error("simulated outage")) };

    const result = await updateTeamSkillProgress(
      "token",
      TEAM_ID,
      TREE_ID,
      "node-1",
      baseDeps({ progress, treeReader }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure, not partial success, when the write fails", async () => {
    const progress: SkillProgressDocStore = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => validProgressData() }),
      update: vi.fn().mockRejectedValue(new Error("simulated outage")),
    };

    const result = await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never logs on any path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps());

    const failingProgress: SkillProgressDocStore = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => validProgressData() }),
      update: vi.fn().mockRejectedValue(new Error("simulated outage")),
    };
    await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress: failingProgress }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
