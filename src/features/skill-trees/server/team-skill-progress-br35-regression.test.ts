import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";
import { startTeamSkillTracking } from "./start-team-skill-tracking";
import { updateTeamSkillProgress } from "./update-team-skill-progress";
import { updateSkillTree } from "./update-skill-tree";
import { getTeamSkillProgress } from "./get-team-skill-progress";

/**
 * A shared, in-memory Firestore-like store for `skillTrees`/`skillProgress`
 * so this test can drive the real `startTeamSkillTracking`,
 * `updateTeamSkillProgress`, `updateSkillTree`, and `getTeamSkillProgress`
 * server operations against one consistent, mutating dataset — this is the
 * literal BR-35 regression TASK-002 deferred (no `getTeamSkillProgress`
 * yet) and TASK-003 partially covered (no `getTeamSkillProgress` yet);
 * TASK-004 is the first task where all four operations coexist.
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
const MEMBER_UID = "member-1";
const TEAM_ID = "team-1";
const TREE_ID = "tree-1";

function adminIdentity(): VerifiedIdentity {
  return { uid: ADMIN_UID, email: ADMIN_EMAIL, emailVerified: true };
}

function memberIdentity(): VerifiedIdentity {
  return { uid: MEMBER_UID, email: "dev@example.com", emailVerified: true };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function fakeAuthCollection(): AuthorizeTeamAccessCollection {
  return {
    async getTeamStatus(teamId) {
      return teamId === TEAM_ID ? "active" : undefined;
    },
    async getMembership(uid, teamId) {
      return uid === MEMBER_UID && teamId === TEAM_ID ? { uid, teamId } : undefined;
    },
  };
}

describe("BR-35 full regression: startTeamSkillTracking -> updateTeamSkillProgress -> updateSkillTree -> getTeamSkillProgress", () => {
  it("a team's currentNodeId keeps resolving to the same stable node, with the corrected name/label reflected, after a cosmetic tree correction", async () => {
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

    const adminDeps = {
      verifyToken: verifyTokenReturning(adminIdentity()),
      allowList: [ADMIN_EMAIL],
    };

    // 1-2. Start tracking for the team against the existing tree.
    const started = await startTeamSkillTracking("token", TEAM_ID, TREE_ID, {
      ...adminDeps,
      treeReader: trees,
      teamStatusReader: { getTeamStatus: async () => "active" },
      progress,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(started).toEqual({ ok: true });

    // 3. Set progress to a concrete, stable node — otherwise the regression
    // would only prove the trivial `currentNodeId: null` case.
    const moved = await updateTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", {
      ...adminDeps,
      progress,
      treeReader: trees,
      now: new Date("2026-01-02T00:00:00Z"),
    });
    expect(moved).toEqual({ ok: true });

    // 4. Cosmetically correct the tree — name and the tracked node-1's label
    // both change; structure (nodeId/order/count) is preserved.
    const corrected = await updateSkillTree(
      "token",
      TREE_ID,
      "Container adoption (corrected)",
      ["Container fundamentals", "Evaluate options (fixed typo)", "Build competence"],
      { ...adminDeps, docs: trees, now: new Date("2026-01-03T00:00:00Z") },
    );
    expect(corrected).toEqual({ ok: true });

    // 5-6. Read the team's progress as an authorized member — the existing
    // progress must still resolve to the same stable node-1, and the DTO
    // must reflect the corrected name/label.
    const authCollection = fakeAuthCollection();
    const read = await getTeamSkillProgress("token", TEAM_ID, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      membershipReader: authCollection,
      teamStatusReader: authCollection,
      progressReader: {
        async listRawForTeam(teamId) {
          return Array.from(progress.docs.entries())
            .filter(([, data]) => data.teamId === teamId)
            .map(([id, data]) => ({ id, data }));
        },
      },
      treeReader: trees,
    });

    expect(read).toEqual({
      ok: true,
      skills: [
        {
          treeId: TREE_ID,
          name: "Container adoption (corrected)",
          nodes: [
            { nodeId: "node-0", label: "Container fundamentals", order: 0 },
            { nodeId: "node-1", label: "Evaluate options (fixed typo)", order: 1 },
            { nodeId: "node-2", label: "Build competence", order: 2 },
          ],
          currentNodeId: "node-1",
        },
      ],
      // The reading member also holds real team membership on an active
      // team (docs/features/skill-progress-self-report/SPEC.md —
      // "Permission-UI correction").
      canReportProgress: true,
    });
  });
});
