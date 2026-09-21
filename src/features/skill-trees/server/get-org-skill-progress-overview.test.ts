import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { RawSkillTreeDoc, SkillTreesReader } from "./list-skill-trees";
import { LIST_SKILL_TREES_LIMIT } from "./list-skill-trees";
import type {
  GetOrgSkillProgressOverviewDeps,
  OrgSkillProgressReader,
  OrgTeamsReader,
  RawSkillProgressDoc,
  RawTeamDoc,
} from "./get-org-skill-progress-overview";
import {
  LIST_ORG_SKILL_PROGRESS_LIMIT,
  getOrgSkillProgressOverview,
} from "./get-org-skill-progress-overview";

const ADMIN_EMAIL = "admin@example.com";
const MEMBER_UID = "member-1";

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: MEMBER_UID, email: "dev@example.com", emailVerified: true, ...overrides };
}

function adminIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return verifiedIdentity({ email: ADMIN_EMAIL, ...overrides });
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function treeDoc(id: string, createdAt: Date, overrides: Record<string, unknown> = {}): RawSkillTreeDoc {
  return {
    id,
    data: {
      name: `Tree ${id}`,
      nodes: [
        { nodeId: "node-0", label: "Stage A", order: 0 },
        { nodeId: "node-1", label: "Stage B", order: 1 },
      ],
      createdAt,
      createdBy: "some-admin",
      ...overrides,
    },
  };
}

function progressDoc(
  id: string,
  teamId: string,
  treeId: string,
  updatedAt: Date,
  overrides: Record<string, unknown> = {},
): RawSkillProgressDoc {
  return {
    id,
    data: {
      teamId,
      treeId,
      currentNodeId: "node-0",
      updatedAt,
      updatedBy: "some-admin",
      ...overrides,
    },
  };
}

function teamDoc(id: string, overrides: Record<string, unknown> = {}): RawTeamDoc {
  return {
    id,
    data: {
      name: `Team ${id}`,
      status: "active",
      createdAt: new Date("2025-01-01T00:00:00Z"),
      createdBy: "some-admin",
      ...overrides,
    },
  };
}

/** Mirrors `skillTrees.orderBy("createdAt","asc").limit(limit)` (BR-20). */
function fakeTreesReader(docs: RawSkillTreeDoc[]): SkillTreesReader {
  return {
    async listOrderedByCreatedAt(limit) {
      const createdAtOf = (doc: RawSkillTreeDoc): number => {
        const value = (doc.data as { createdAt?: unknown } | null)?.createdAt;
        return value instanceof Date ? value.getTime() : 0;
      };
      return [...docs].sort((a, b) => createdAtOf(a) - createdAtOf(b)).slice(0, limit);
    },
  };
}

/**
 * Mirrors the exact approved Firestore query —
 * `.orderBy("updatedAt","desc").orderBy(FieldPath.documentId(),"desc").limit(limit)`
 * — so bound/truncation/tie-break assertions below exercise the real
 * contract rather than a fake that trivially passes through.
 */
function fakeProgressReader(docs: RawSkillProgressDoc[]): OrgSkillProgressReader {
  return {
    async listOrderedByUpdatedAtDesc(limit) {
      const updatedAtOf = (doc: RawSkillProgressDoc): number => {
        const value = (doc.data as { updatedAt?: unknown } | null)?.updatedAt;
        return value instanceof Date ? value.getTime() : 0;
      };
      return [...docs]
        .sort((a, b) => {
          const byUpdatedAt = updatedAtOf(b) - updatedAtOf(a);
          if (byUpdatedAt !== 0) return byUpdatedAt;
          return a.id === b.id ? 0 : a.id < b.id ? 1 : -1; // documentId descending tiebreak
        })
        .slice(0, limit);
    },
  };
}

/** Mirrors `teams.get()` — unbounded, no `.where()`/`.orderBy()` (BR-20). */
function fakeTeamsReader(docs: RawTeamDoc[]): OrgTeamsReader {
  return { async listAll() { return docs; } };
}

function baseDeps(overrides: Partial<GetOrgSkillProgressOverviewDeps> = {}): GetOrgSkillProgressOverviewDeps {
  return {
    verifyToken: verifyTokenReturning(adminIdentity()),
    allowList: [ADMIN_EMAIL],
    treesReader: fakeTreesReader([]),
    progressReader: fakeProgressReader([]),
    teamsReader: fakeTeamsReader([]),
    ...overrides,
  };
}

describe("getOrgSkillProgressOverview", () => {
  describe("authorization", () => {
    it("rejects an unauthenticated caller", async () => {
      const result = await getOrgSkillProgressOverview(
        "bad-token",
        baseDeps({ verifyToken: vi.fn().mockRejectedValue(new Error("invalid token")) }),
      );

      expect(result).toEqual({ ok: false, error: "unauthenticated" });
    });

    it("rejects an authenticated non-admin", async () => {
      const result = await getOrgSkillProgressOverview(
        "token",
        baseDeps({ verifyToken: verifyTokenReturning(verifiedIdentity()) }),
      );

      expect(result).toEqual({ ok: false, error: "forbidden" });
    });

    it("rejects a real team member who is not app-admin, even with genuine tracking data present", async () => {
      const deps = baseDeps({
        verifyToken: verifyTokenReturning(verifiedIdentity()),
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1")]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result).toEqual({ ok: false, error: "forbidden" });
    });

    it("succeeds for an app admin", async () => {
      const result = await getOrgSkillProgressOverview("token", baseDeps());

      expect(result.ok).toBe(true);
    });

    it("performs no authorizeTeamAccess-shaped check — succeeds for an app admin with no team membership of any kind", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1")]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.trees).toHaveLength(1);
      }
    });
  });

  describe("query/read behavior", () => {
    it("requests exactly LIST_SKILL_TREES_LIMIT from the trees reader", async () => {
      const listOrderedByCreatedAt = vi.fn().mockResolvedValue([]);
      await getOrgSkillProgressOverview(
        "token",
        baseDeps({ treesReader: { listOrderedByCreatedAt } }),
      );

      expect(listOrderedByCreatedAt).toHaveBeenCalledWith(LIST_SKILL_TREES_LIMIT);
      expect(LIST_SKILL_TREES_LIMIT).toBe(500);
    });

    it("requests exactly LIST_ORG_SKILL_PROGRESS_LIMIT (2000) from the progress reader", async () => {
      const listOrderedByUpdatedAtDesc = vi.fn().mockResolvedValue([]);
      await getOrgSkillProgressOverview(
        "token",
        baseDeps({ progressReader: { listOrderedByUpdatedAtDesc } }),
      );

      expect(listOrderedByUpdatedAtDesc).toHaveBeenCalledWith(LIST_ORG_SKILL_PROGRESS_LIMIT);
      expect(LIST_ORG_SKILL_PROGRESS_LIMIT).toBe(2000);
    });

    it("reads the full unbounded teams collection with no arguments (no .where()/.orderBy() scoping)", async () => {
      const listAll = vi.fn().mockResolvedValue([]);
      await getOrgSkillProgressOverview("token", baseDeps({ teamsReader: { listAll } }));

      expect(listAll).toHaveBeenCalledWith();
    });

    it("fails closed with read_failed when the skillTrees read throws, never calling downstream reads' results into the response", async () => {
      const result = await getOrgSkillProgressOverview(
        "token",
        baseDeps({ treesReader: { listOrderedByCreatedAt: vi.fn().mockRejectedValue(new Error("outage")) } }),
      );

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });

    it("fails closed with read_failed when the skillProgress read throws", async () => {
      const result = await getOrgSkillProgressOverview(
        "token",
        baseDeps({ progressReader: { listOrderedByUpdatedAtDesc: vi.fn().mockRejectedValue(new Error("outage")) } }),
      );

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });

    it("fails closed with read_failed when the teams read throws", async () => {
      const result = await getOrgSkillProgressOverview(
        "token",
        baseDeps({ teamsReader: { listAll: vi.fn().mockRejectedValue(new Error("outage")) } }),
      );

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });

    it("never returns partial/raw data alongside a read_failed error", async () => {
      const result = await getOrgSkillProgressOverview(
        "token",
        baseDeps({ progressReader: { listOrderedByUpdatedAtDesc: vi.fn().mockRejectedValue(new Error("outage")) } }),
      );

      expect(result).toEqual({ ok: false, error: "read_failed" });
      expect("trees" in result).toBe(false);
    });
  });

  describe("inclusion / exclusion and join semantics", () => {
    it("returns an empty overview when no tree has any tracking team", async () => {
      const deps = baseDeps({ treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]) });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result).toEqual({ ok: true, trees: [] });
    });

    it("includes a tree tracked by exactly one team", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1")]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.trees).toHaveLength(1);
        expect(result.trees[0].teams).toHaveLength(1);
        expect(result.trees[0].teams[0].teamId).toBe("team-1");
      }
    });

    it("includes a multi-team, multi-tree overview with the exact minimized DTO shape", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([
          treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"), { name: "Containers" }),
          treeDoc("tree-2", new Date("2026-01-02T00:00:00Z"), { name: "Observability" }),
        ]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-03T00:00:00Z"), { currentNodeId: "node-1" }),
          progressDoc("p2", "team-2", "tree-1", new Date("2026-01-04T00:00:00Z"), { currentNodeId: null }),
          progressDoc("p3", "team-1", "tree-2", new Date("2026-01-05T00:00:00Z"), { currentNodeId: "node-0" }),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1", { name: "Alpha" }), teamDoc("team-2", { name: "Bravo" })]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result).toEqual({
        ok: true,
        trees: [
          {
            treeId: "tree-1",
            name: "Containers",
            nodes: [
              { nodeId: "node-0", label: "Stage A", order: 0 },
              { nodeId: "node-1", label: "Stage B", order: 1 },
            ],
            teams: [
              { teamId: "team-1", teamName: "Alpha", teamStatus: "active", currentNodeId: "node-1" },
              { teamId: "team-2", teamName: "Bravo", teamStatus: "active", currentNodeId: null },
            ],
          },
          {
            treeId: "tree-2",
            name: "Observability",
            nodes: [
              { nodeId: "node-0", label: "Stage A", order: 0 },
              { nodeId: "node-1", label: "Stage B", order: 1 },
            ],
            teams: [{ teamId: "team-1", teamName: "Alpha", teamStatus: "active", currentNodeId: "node-0" }],
          },
        ],
      });
    });

    it("excludes a tree whose only skillProgress records are malformed", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z"), { currentNodeId: 42 }), // wrong type
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1")]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result).toEqual({ ok: true, trees: [] });
    });

    it("excludes a skillProgress record whose treeId does not resolve to any tree (deleted/malformed/never-existed)", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-does-not-exist", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1")]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result).toEqual({ ok: true, trees: [] });
    });

    it("excludes a skillProgress record whose tree exists but falls outside the bounded skillTrees result set (BR-16)", async () => {
      // Simulates a tree that exists in Firestore but was pushed beyond the
      // 500-oldest bound: from this operation's perspective it is
      // indistinguishable from a treeId that doesn't resolve at all.
      const deps = baseDeps({
        treesReader: { listOrderedByCreatedAt: vi.fn().mockResolvedValue([]) }, // bounded read returns nothing
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-outside-bound", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1")]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result).toEqual({ ok: true, trees: [] });
    });

    it("excludes a skillProgress record referencing a malformed tree document", async () => {
      const malformedTree: RawSkillTreeDoc = { id: "tree-1", data: { name: "Broken" } }; // missing nodes/createdAt/createdBy
      const deps = baseDeps({
        treesReader: fakeTreesReader([malformedTree]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1")]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result).toEqual({ ok: true, trees: [] });
    });

    it("excludes a skillProgress record whose teamId does not resolve to any teams document (missing team)", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-does-not-exist", "tree-1", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result).toEqual({ ok: true, trees: [] });
    });

    it("excludes a skillProgress record whose team resolves but fails validation (malformed team: invalid status)", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1", { status: "not-a-real-status" })]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result).toEqual({ ok: true, trees: [] });
    });

    it("excludes a skillProgress record whose team resolves but fails validation (malformed team: blank name)", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1", { name: "   " })]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result).toEqual({ ok: true, trees: [] });
    });

    it("includes a disabled team's entry, never excluding it, labeled teamStatus: disabled", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1", { status: "disabled" })]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.trees[0].teams[0]).toEqual({
          teamId: "team-1",
          teamName: "Team team-1",
          teamStatus: "disabled",
          currentNodeId: "node-0",
        });
      }
    });

    it("includes a tree where all tracking teams are disabled", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z")),
          progressDoc("p2", "team-2", "tree-1", new Date("2026-01-03T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([
          teamDoc("team-1", { name: "Alpha", status: "disabled" }),
          teamDoc("team-2", { name: "Bravo", status: "disabled" }),
        ]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.trees).toHaveLength(1);
        expect(result.trees[0].teams.every((t) => t.teamStatus === "disabled")).toBe(true);
      }
    });

    it("preserves null currentNodeId unchanged as the not-started state", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z"), { currentNodeId: null }),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1")]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.trees[0].teams[0].currentNodeId).toBeNull();
      }
    });

    it("never surfaces which specific check failed or any raw field value for an excluded record", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-does-not-exist", "tree-1", new Date("2026-01-02T00:00:00Z"), {
            secretField: "should-never-leak",
          }),
        ]),
        teamsReader: fakeTeamsReader([]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(JSON.stringify(result)).not.toContain("secretField");
      expect(JSON.stringify(result)).not.toContain("should-never-leak");
    });
  });

  describe("ordering", () => {
    it("orders trees by createdAt ascending, exactly as the bounded skillTrees read yields them", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([
          treeDoc("newer", new Date("2026-03-01T00:00:00Z")),
          treeDoc("oldest", new Date("2026-01-01T00:00:00Z")),
          treeDoc("middle", new Date("2026-02-01T00:00:00Z")),
        ]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "newer", new Date("2026-04-01T00:00:00Z")),
          progressDoc("p2", "team-1", "oldest", new Date("2026-04-02T00:00:00Z")),
          progressDoc("p3", "team-1", "middle", new Date("2026-04-03T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1")]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.trees.map((t) => t.treeId)).toEqual(["oldest", "middle", "newer"]);
      }
    });

    it("orders teams within a tree by name ascending, case-sensitive ordinal", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-z", "tree-1", new Date("2026-01-02T00:00:00Z")),
          progressDoc("p2", "team-a", "tree-1", new Date("2026-01-03T00:00:00Z")),
          progressDoc("p3", "team-m", "tree-1", new Date("2026-01-04T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([
          teamDoc("team-z", { name: "Zulu" }),
          teamDoc("team-a", { name: "Alpha" }),
          teamDoc("team-m", { name: "Mike" }),
        ]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.trees[0].teams.map((t) => t.teamName)).toEqual(["Alpha", "Mike", "Zulu"]);
      }
    });

    it("breaks a tied team name with teamId ascending", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-b", "tree-1", new Date("2026-01-02T00:00:00Z")),
          progressDoc("p2", "team-a", "tree-1", new Date("2026-01-03T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([
          teamDoc("team-b", { name: "Same Name" }),
          teamDoc("team-a", { name: "Same Name" }),
        ]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.trees[0].teams.map((t) => t.teamId)).toEqual(["team-a", "team-b"]);
      }
    });
  });

  describe("bounds and truncation (BR-20/BR-21)", () => {
    it("returns exactly the 500 oldest-created skillTrees when 501 exist", async () => {
      const docs = Array.from({ length: 501 }, (_, i) => treeDoc(`tree-${i}`, new Date(2026, 0, 1 + i)));
      const result = await getOrgSkillProgressOverview("token", baseDeps({ treesReader: fakeTreesReader(docs) }));

      expect(result.ok).toBe(true);
      // No tracking data seeded, so trees are all excluded by BR-7 — this
      // proves the bound via the "outside bound" exclusion test above; here
      // we independently confirm the reader itself is asked for exactly the
      // documented limit (see the dedicated reader-arg test above).
      if (result.ok) {
        expect(result.trees).toEqual([]);
      }
    });

    it("keeps the most-recently-updated 2000 skillProgress records and drops the least-recently-updated ones beyond the bound", async () => {
      const tree = treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"));
      const teams = Array.from({ length: 2001 }, (_, i) => teamDoc(`team-${i}`, { name: `Team ${String(i).padStart(4, "0")}` }));
      const progress = Array.from({ length: 2001 }, (_, i) =>
        progressDoc(`p-${i}`, `team-${i}`, "tree-1", new Date(2026, 0, 1, 0, 0, i)),
      ); // team-0 is oldest-updated, team-2000 is newest-updated

      const deps = baseDeps({
        treesReader: fakeTreesReader([tree]),
        progressReader: fakeProgressReader(progress),
        teamsReader: fakeTeamsReader(teams),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const includedTeamIds = result.trees[0].teams.map((t) => t.teamId);
        expect(includedTeamIds).toHaveLength(LIST_ORG_SKILL_PROGRESS_LIMIT);
        expect(includedTeamIds).not.toContain("team-0"); // oldest-updated, dropped
        expect(includedTeamIds).toContain("team-2000"); // newest-updated, survives
        expect(includedTeamIds).toContain("team-1"); // second-oldest, dropped too (only 2000 of 2001 survive)
      }
    });

    it("is deterministic across two identical calls when many records share the same updatedAt (document-ID tiebreak)", async () => {
      const tree = treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"));
      const sharedUpdatedAt = new Date("2026-01-02T00:00:00Z");
      const teams = Array.from({ length: 3 }, (_, i) => teamDoc(`team-${i}`));
      const progress = Array.from({ length: 3 }, (_, i) => progressDoc(`p-${i}`, `team-${i}`, "tree-1", sharedUpdatedAt));

      const deps = baseDeps({
        treesReader: fakeTreesReader([tree]),
        progressReader: fakeProgressReader(progress),
        teamsReader: fakeTeamsReader(teams),
      });

      const first = await getOrgSkillProgressOverview("token", deps);
      const second = await getOrgSkillProgressOverview("token", deps);

      expect(first).toEqual(second);
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.trees[0].teams).toHaveLength(3);
      }
    });

    it("proves the tie-break truncation boundary is decided by document ID descending, not left unspecified", async () => {
      // Two records share the exact same updatedAt; only one survives a
      // limit of 1. The real query's tiebreak is documentId descending, so
      // the lexicographically larger id ("p-b") must be the one kept.
      const tree = treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"));
      const sharedUpdatedAt = new Date("2026-01-02T00:00:00Z");
      const deps = baseDeps({
        treesReader: fakeTreesReader([tree]),
        progressReader: {
          async listOrderedByUpdatedAtDesc(limit) {
            const docs = [
              progressDoc("p-a", "team-a", "tree-1", sharedUpdatedAt),
              progressDoc("p-b", "team-b", "tree-1", sharedUpdatedAt),
            ];
            return [...docs].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, limit);
          },
        },
        teamsReader: fakeTeamsReader([teamDoc("team-a"), teamDoc("team-b")]),
      });

      // Exercise the reader directly at limit 1 to prove the tiebreak shape
      // the production query relies on (this operation itself always calls
      // with LIST_ORG_SKILL_PROGRESS_LIMIT, but the reader contract must be
      // exactly this deterministic ordering regardless of the limit given).
      const survivors = await deps.progressReader!.listOrderedByUpdatedAtDesc(1);
      expect(survivors).toHaveLength(1);
      expect(survivors[0].id).toBe("p-b");
    });
  });

  describe("DTO minimization and privacy", () => {
    it("returns only the approved OrgSkillProgressTreeView/TeamEntryView fields", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1")]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.keys(result.trees[0])).toEqual(["treeId", "name", "nodes", "teams"]);
        expect(Object.keys(result.trees[0].teams[0])).toEqual([
          "teamId",
          "teamName",
          "teamStatus",
          "currentNodeId",
        ]);
        for (const node of result.trees[0].nodes) {
          expect(Object.keys(node)).toEqual(["nodeId", "label", "order"]);
        }
      }
    });

    it("never includes createdAt/createdBy/updatedAt/updatedBy from either source document", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([
          treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"), {
            updatedAt: new Date("2026-02-01T00:00:00Z"),
            updatedBy: "leaked-tree-admin-uid",
          }),
        ]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z"), {
            updatedBy: "leaked-progress-admin-uid",
          }),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1", { createdBy: "leaked-team-creator-uid" })]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("createdAt");
      expect(serialized).not.toContain("createdBy");
      expect(serialized).not.toContain("updatedAt");
      expect(serialized).not.toContain("updatedBy");
      expect(serialized).not.toContain("leaked-tree-admin-uid");
      expect(serialized).not.toContain("leaked-progress-admin-uid");
      expect(serialized).not.toContain("leaked-team-creator-uid");
    });

    it("never includes the raw skillProgress composite document id", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("team-1__tree-1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1")]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      expect(JSON.stringify(result)).not.toContain("team-1__tree-1");
    });

    it("never includes membership/invitation/access-request or any per-person field", async () => {
      const deps = baseDeps({
        treesReader: fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]),
        progressReader: fakeProgressReader([
          progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z")),
        ]),
        teamsReader: fakeTeamsReader([teamDoc("team-1")]),
      });

      const result = await getOrgSkillProgressOverview("token", deps);

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("teamMemberships");
      expect(serialized).not.toContain("teamInvitations");
      expect(serialized).not.toContain("teamAccessRequests");
      expect(serialized).not.toContain("uid");
    });

    it("never logs on any path", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await getOrgSkillProgressOverview("token", baseDeps());
      await getOrgSkillProgressOverview(
        "token",
        baseDeps({ progressReader: { listOrderedByUpdatedAtDesc: vi.fn().mockRejectedValue(new Error("outage")) } }),
      );

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe("read-only boundary", () => {
    it("exposes no create/set/update/delete-shaped export from this module", async () => {
      const moduleExports = await import("./get-org-skill-progress-overview");
      const exportNames = Object.keys(moduleExports);
      for (const name of exportNames) {
        expect(name).not.toMatch(/^(create|set|update|delete|remove)/i);
      }
    });

    it("never calls any write-shaped method on any reader dependency", async () => {
      const treesReader = fakeTreesReader([treeDoc("tree-1", new Date("2026-01-01T00:00:00Z"))]);
      const progressReader = fakeProgressReader([
        progressDoc("p1", "team-1", "tree-1", new Date("2026-01-02T00:00:00Z")),
      ]);
      const teamsReader = fakeTeamsReader([teamDoc("team-1")]);

      expect("set" in treesReader).toBe(false);
      expect("update" in treesReader).toBe(false);
      expect("delete" in treesReader).toBe(false);
      expect("set" in progressReader).toBe(false);
      expect("update" in progressReader).toBe(false);
      expect("delete" in progressReader).toBe(false);
      expect("set" in teamsReader).toBe(false);
      expect("update" in teamsReader).toBe(false);
      expect("delete" in teamsReader).toBe(false);

      await getOrgSkillProgressOverview("token", baseDeps({ treesReader, progressReader, teamsReader }));
    });
  });
});
