import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { startTeamSkillTracking } from "./start-team-skill-tracking";
import { updateTeamSkillProgress } from "./update-team-skill-progress";
import { stopTeamSkillTracking } from "./stop-team-skill-tracking";
import { updateSkillTree } from "./update-skill-tree";

/**
 * A shared, in-memory Firestore-like store for exactly the two collections
 * this lifecycle regression touches (`skillTrees`, `skillProgress`), so a
 * single test can drive `startTeamSkillTracking`/`updateTeamSkillProgress`/
 * `stopTeamSkillTracking`/`updateSkillTree` against one consistent, mutating
 * dataset — mirroring this codebase's cross-module regression convention
 * (e.g. `challenge-management-concurrency.test.ts`) rather than each
 * operation's own isolated per-call fake.
 */
function inMemoryCollection() {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    async get(id: string) {
      const data = docs.get(id);
      return { exists: data !== undefined, data: () => data };
    },
    async set(id: string, record: unknown) {
      docs.set(id, record as Record<string, unknown>);
    },
    async update(id: string, patch: unknown) {
      const existing = docs.get(id);
      docs.set(id, { ...existing, ...(patch as Record<string, unknown>) });
    },
    async delete(id: string) {
      docs.delete(id);
    },
  };
}

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

describe("team skill tracking lifecycle", () => {
  it("start (active team) -> update forward -> update backward -> stop -> start again produces a fresh currentNodeId: null", async () => {
    const trees = inMemoryCollection();
    const progress = inMemoryCollection();
    trees.docs.set(TREE_ID, {
      name: "Container adoption",
      nodes: [
        { nodeId: "node-0", label: "Container fundamentals", order: 0 },
        { nodeId: "node-1", label: "Evaluate alternatives", order: 1 },
        { nodeId: "node-2", label: "Build competence", order: 2 },
      ],
      createdAt: new Date("2025-01-01T00:00:00Z"),
      createdBy: "original-admin",
    });

    const deps = {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      allowList: [ADMIN_EMAIL],
    };

    const started = await startTeamSkillTracking(
      "token",
      TEAM_ID,
      TREE_ID,
      { ...deps, treeReader: trees, teamStatusReader: { getTeamStatus: async () => "active" }, progress, now: new Date("2026-01-01T00:00:00Z") },
    );
    expect(started).toEqual({ ok: true });
    expect(progress.docs.get(`${TEAM_ID}__${TREE_ID}`)?.currentNodeId).toBeNull();

    const movedForward = await updateTeamSkillProgress(
      "token",
      TEAM_ID,
      TREE_ID,
      "node-2",
      { ...deps, progress, treeReader: trees, now: new Date("2026-02-01T00:00:00Z") },
    );
    expect(movedForward).toEqual({ ok: true });
    expect(progress.docs.get(`${TEAM_ID}__${TREE_ID}`)?.currentNodeId).toBe("node-2");

    const movedBackward = await updateTeamSkillProgress(
      "token",
      TEAM_ID,
      TREE_ID,
      "node-1",
      { ...deps, progress, treeReader: trees, now: new Date("2026-03-01T00:00:00Z") },
    );
    expect(movedBackward).toEqual({ ok: true });
    expect(progress.docs.get(`${TEAM_ID}__${TREE_ID}`)?.currentNodeId).toBe("node-1");

    const stopped = await stopTeamSkillTracking("token", TEAM_ID, TREE_ID, { ...deps, progress });
    expect(stopped).toEqual({ ok: true });
    expect(progress.docs.has(`${TEAM_ID}__${TREE_ID}`)).toBe(false);

    // Restart: no residual state anywhere makes the restarted initial stage
    // ambiguous — it must be identical to the very first start.
    const restarted = await startTeamSkillTracking(
      "token",
      TEAM_ID,
      TREE_ID,
      { ...deps, treeReader: trees, teamStatusReader: { getTeamStatus: async () => "active" }, progress, now: new Date("2026-04-01T00:00:00Z") },
    );
    expect(restarted).toEqual({ ok: true });
    expect(progress.docs.get(`${TEAM_ID}__${TREE_ID}`)?.currentNodeId).toBeNull();
  });

  it("stopping is idempotent, then a repeated stop returns the same success with no recreated record", async () => {
    const progress = inMemoryCollection();
    const deps = {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      allowList: [ADMIN_EMAIL],
      progress,
    };

    const firstStop = await stopTeamSkillTracking("token", TEAM_ID, TREE_ID, deps);
    const secondStop = await stopTeamSkillTracking("token", TEAM_ID, TREE_ID, deps);

    expect(firstStop).toEqual({ ok: true });
    expect(secondStop).toEqual({ ok: true });
    expect(progress.docs.has(`${TEAM_ID}__${TREE_ID}`)).toBe(false);
  });

  it("a team's currentNodeId remains valid after a cosmetic correction to the tracked tree (BR-35 partial regression)", async () => {
    const trees = inMemoryCollection();
    const progress = inMemoryCollection();
    trees.docs.set(TREE_ID, {
      name: "Container adoption",
      nodes: [
        { nodeId: "node-0", label: "Container fundamentals", order: 0 },
        { nodeId: "node-1", label: "Evaluate alternatives", order: 1 },
      ],
      createdAt: new Date("2025-01-01T00:00:00Z"),
      createdBy: "original-admin",
    });

    const deps = {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      allowList: [ADMIN_EMAIL],
    };

    await startTeamSkillTracking("token", TEAM_ID, TREE_ID, {
      ...deps,
      treeReader: trees,
      teamStatusReader: { getTeamStatus: async () => "active" },
      progress,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", {
      ...deps,
      progress,
      treeReader: trees,
      now: new Date("2026-01-02T00:00:00Z"),
    });
    expect(progress.docs.get(`${TEAM_ID}__${TREE_ID}`)?.currentNodeId).toBe("node-1");

    const corrected = await updateSkillTree(
      "token",
      TREE_ID,
      "Container adoption (corrected)",
      ["Container fundamentals", "Evaluate options (fixed typo)"],
      { ...deps, docs: trees, now: new Date("2026-01-03T00:00:00Z") },
    );
    expect(corrected).toEqual({ ok: true });

    // The corrected tree's node-1 must still exist, unchanged in identity —
    // only its label differs — so the team's existing currentNodeId
    // continues to resolve. TASK-004's own getTeamSkillProgress test suite
    // owns the full three-operation BR-35 regression (start ->
    // updateSkillTree -> getTeamSkillProgress); this proves the two-
    // operation slice available at this task's boundary.
    const correctedTree = trees.docs.get(TREE_ID) as { nodes: Array<{ nodeId: string; label: string }> };
    const trackedNode = correctedTree.nodes.find((node) => node.nodeId === "node-1");
    expect(trackedNode).toEqual({ nodeId: "node-1", label: "Evaluate options (fixed typo)", order: 1 });
    expect(progress.docs.get(`${TEAM_ID}__${TREE_ID}`)?.currentNodeId).toBe("node-1");
  });
});
