import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { SkillProgressRecord } from "../domain/skill-progress";
import type {
  SkillProgressStore,
  SkillTreeReader,
  StartTeamSkillTrackingDeps,
  StartTeamSkillTrackingDocSnapshot,
  TeamStatusReader,
} from "./start-team-skill-tracking";
import { startTeamSkillTracking } from "./start-team-skill-tracking";

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

function validTreeData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Container adoption",
    nodes: [
      { nodeId: "node-0", label: "Container fundamentals", order: 0 },
      { nodeId: "node-1", label: "Evaluate alternatives", order: 1 },
    ],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: "original-admin",
    ...overrides,
  };
}

function fakeTreeReader(data: Record<string, unknown> | undefined): SkillTreeReader {
  return {
    async get(): Promise<StartTeamSkillTrackingDocSnapshot> {
      return { exists: data !== undefined, data: () => data };
    },
  };
}

function fakeTeamStatusReader(status: unknown): TeamStatusReader {
  return { getTeamStatus: vi.fn().mockResolvedValue(status) };
}

interface FakeSkillProgressStore extends SkillProgressStore {
  writes: { docId: string; record: SkillProgressRecord }[];
}

function fakeProgressStore(existing?: Record<string, unknown>): FakeSkillProgressStore {
  const writes: { docId: string; record: SkillProgressRecord }[] = [];
  return {
    writes,
    async get(): Promise<StartTeamSkillTrackingDocSnapshot> {
      return { exists: existing !== undefined, data: () => existing };
    },
    async set(docId, record) {
      writes.push({ docId, record });
    },
  };
}

function baseDeps(overrides: Partial<StartTeamSkillTrackingDeps> = {}): StartTeamSkillTrackingDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    treeReader: fakeTreeReader(validTreeData()),
    teamStatusReader: fakeTeamStatusReader("active"),
    progress: fakeProgressStore(undefined),
    now: NOW,
    ...overrides,
  };
}

describe("startTeamSkillTracking", () => {
  it("starts tracking on an active team, persisting exactly the approved shape with currentNodeId: null", async () => {
    const progress = fakeProgressStore(undefined);

    const result = await startTeamSkillTracking(
      "token",
      TEAM_ID,
      TREE_ID,
      baseDeps({ progress }),
    );

    expect(result).toEqual({ ok: true });
    expect(progress.writes).toEqual([
      {
        docId: `${TEAM_ID}__${TREE_ID}`,
        record: {
          teamId: TEAM_ID,
          treeId: TREE_ID,
          currentNodeId: null,
          updatedAt: NOW,
          updatedBy: ADMIN_UID,
        },
      },
    ]);
    expect(Object.keys(progress.writes[0].record)).toEqual([
      "teamId",
      "treeId",
      "currentNodeId",
      "updatedAt",
      "updatedBy",
    ]);
  });

  it("derives the deterministic progress document id from teamId/treeId", async () => {
    const progress = fakeProgressStore(undefined);

    await startTeamSkillTracking("token", "team-42", "tree-99", baseDeps({ progress }));

    expect(progress.writes[0].docId).toBe("team-42__tree-99");
  });

  it("rejects an unauthenticated caller and attempts no write", async () => {
    const progress = fakeProgressStore(undefined);
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await startTeamSkillTracking(
      "bad-token",
      TEAM_ID,
      TREE_ID,
      baseDeps({ progress, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(progress.writes).toHaveLength(0);
  });

  it("rejects a non-admin caller and attempts no write", async () => {
    const progress = fakeProgressStore(undefined);
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await startTeamSkillTracking(
      "token",
      TEAM_ID,
      TREE_ID,
      baseDeps({ progress, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(progress.writes).toHaveLength(0);
  });

  it("rejects a nonexistent tree with tree_not_found and attempts no write", async () => {
    const progress = fakeProgressStore(undefined);

    const result = await startTeamSkillTracking(
      "token",
      TEAM_ID,
      TREE_ID,
      baseDeps({ progress, treeReader: fakeTreeReader(undefined) }),
    );

    expect(result).toEqual({ ok: false, error: "tree_not_found" });
    expect(progress.writes).toHaveLength(0);
  });

  it("fails closed with tree_not_found on a malformed persisted tree document", async () => {
    const progress = fakeProgressStore(undefined);
    const malformedTree = { name: "Container adoption" }; // missing nodes/createdAt/createdBy

    const result = await startTeamSkillTracking(
      "token",
      TEAM_ID,
      TREE_ID,
      baseDeps({ progress, treeReader: fakeTreeReader(malformedTree) }),
    );

    expect(result).toEqual({ ok: false, error: "tree_not_found" });
    expect(progress.writes).toHaveLength(0);
  });

  it("rejects a disabled team with team_disabled and attempts no write", async () => {
    const progress = fakeProgressStore(undefined);

    const result = await startTeamSkillTracking(
      "token",
      TEAM_ID,
      TREE_ID,
      baseDeps({ progress, teamStatusReader: fakeTeamStatusReader("disabled") }),
    );

    expect(result).toEqual({ ok: false, error: "team_disabled" });
    expect(progress.writes).toHaveLength(0);
  });

  it("rejects a nonexistent team (undefined status) with team_not_found, distinct from a disabled team", async () => {
    const progress = fakeProgressStore(undefined);

    const result = await startTeamSkillTracking(
      "token",
      TEAM_ID,
      TREE_ID,
      baseDeps({ progress, teamStatusReader: fakeTeamStatusReader(undefined) }),
    );

    expect(result).toEqual({ ok: false, error: "team_not_found" });
    expect(progress.writes).toHaveLength(0);
  });

  it("fails closed with team_not_found on a malformed team status value", async () => {
    const progress = fakeProgressStore(undefined);

    const result = await startTeamSkillTracking(
      "token",
      TEAM_ID,
      TREE_ID,
      baseDeps({ progress, teamStatusReader: fakeTeamStatusReader("archived") }),
    );

    expect(result).toEqual({ ok: false, error: "team_not_found" });
    expect(progress.writes).toHaveLength(0);
  });

  it("is idempotent on an already-tracked pair — success, no write, currentNodeId not reset", async () => {
    const progress = fakeProgressStore({
      teamId: TEAM_ID,
      treeId: TREE_ID,
      currentNodeId: "node-1",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      updatedBy: "some-other-admin",
    });

    const result = await startTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps({ progress }));

    expect(result).toEqual({ ok: true });
    expect(progress.writes).toHaveLength(0);
  });

  it("ignores a request-shaped teamId/treeId override since the function signature has no body parameter for either", async () => {
    const progress = fakeProgressStore(undefined);

    // The only way a caller could attempt this is by calling the function
    // with different positional args than the trusted route scope — there
    // is no third "body" parameter for teamId/treeId to hide inside.
    const result = await startTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps({ progress }));

    expect(result.ok).toBe(true);
    expect(progress.writes[0].record.teamId).toBe(TEAM_ID);
    expect(progress.writes[0].record.treeId).toBe(TREE_ID);
  });

  it("uses the verified acting admin's uid, never a client-supplied updatedBy", async () => {
    const progress = fakeProgressStore(undefined);
    const identity = verifiedIdentity({ uid: "admin-2", email: "second-admin@example.com" });

    await startTeamSkillTracking(
      "token",
      TEAM_ID,
      TREE_ID,
      baseDeps({
        progress,
        verifyToken: verifyTokenReturning(identity),
        allowList: [ADMIN_EMAIL, "second-admin@example.com"],
      }),
    );

    expect(progress.writes[0].record.updatedBy).toBe("admin-2");
  });

  it("reports a controlled failure when reading the tree fails", async () => {
    const progress = fakeProgressStore(undefined);
    const treeReader: SkillTreeReader = { get: vi.fn().mockRejectedValue(new Error("simulated outage")) };

    const result = await startTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps({ progress, treeReader }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure when reading team status fails", async () => {
    const progress = fakeProgressStore(undefined);
    const teamStatusReader: TeamStatusReader = {
      getTeamStatus: vi.fn().mockRejectedValue(new Error("simulated outage")),
    };

    const result = await startTeamSkillTracking(
      "token",
      TEAM_ID,
      TREE_ID,
      baseDeps({ progress, teamStatusReader }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure, not partial success, when the progress write fails", async () => {
    const progress: SkillProgressStore = {
      get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      set: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await startTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps({ progress }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never logs on any path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await startTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps());

    const failingProgress: SkillProgressStore = {
      get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      set: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await startTeamSkillTracking("token", TEAM_ID, TREE_ID, baseDeps({ progress: failingProgress }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
