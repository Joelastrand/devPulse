import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type {
  MembershipReader,
  ReportTeamSkillProgressDeps,
  ReportTeamSkillProgressDocSnapshot,
  SkillProgressDocStore,
  SkillTreeReader,
  TeamStatusReader,
} from "./report-team-skill-progress";
import { reportTeamSkillProgress } from "./report-team-skill-progress";
import { getTeamSkillProgress } from "./get-team-skill-progress";
import type {
  RawSkillProgressDoc,
  SkillProgressReader as GetSkillProgressReader,
  SkillTreeReader as GetSkillTreeReader,
} from "./get-team-skill-progress";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";

const MEMBER_UID = "member-1";
const MEMBER_EMAIL = "dev@example.com";
const ADMIN_EMAIL = "admin@example.com";
const TEAM_ID = "team-1";
const OTHER_TEAM_ID = "team-2";
const TREE_ID = "tree-1";
const NOW = new Date("2026-09-19T00:00:00Z");

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: MEMBER_UID, email: MEMBER_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function validMembershipData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { uid: MEMBER_UID, teamId: TEAM_ID, ...overrides };
}

function validProgressData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    treeId: TREE_ID,
    currentNodeId: "node-0",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    updatedBy: "some-admin",
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

function fakeMembershipReader(data: unknown): MembershipReader {
  return { async getMembership() { return data; } };
}

function fakeTeamStatusReader(status: unknown): TeamStatusReader {
  return { async getTeamStatus() { return status; } };
}

interface FakeProgressStore extends SkillProgressDocStore {
  updates: { docId: string; data: Record<string, unknown> }[];
}

function fakeProgressStore(data: Record<string, unknown> | undefined): FakeProgressStore {
  const updates: { docId: string; data: Record<string, unknown> }[] = [];
  return {
    updates,
    async get(): Promise<ReportTeamSkillProgressDocSnapshot> {
      return { exists: data !== undefined, data: () => data };
    },
    async update(docId, updateData) {
      updates.push({ docId, data: updateData });
    },
  };
}

function fakeTreeReader(data: Record<string, unknown> | undefined): SkillTreeReader {
  return {
    async get(): Promise<ReportTeamSkillProgressDocSnapshot> {
      return { exists: data !== undefined, data: () => data };
    },
  };
}

function baseDeps(overrides: Partial<ReportTeamSkillProgressDeps> = {}): ReportTeamSkillProgressDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    membershipReader: fakeMembershipReader(validMembershipData()),
    teamStatusReader: fakeTeamStatusReader("active"),
    progress: fakeProgressStore(validProgressData()),
    treeReader: fakeTreeReader(validTreeData()),
    now: NOW,
    ...overrides,
  };
}

describe("reportTeamSkillProgress", () => {
  describe("authentication and membership", () => {
    it("succeeds for a genuine Team A member reporting a forward move", async () => {
      const progress = fakeProgressStore(validProgressData());

      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

      expect(result).toEqual({ ok: true });
      expect(progress.updates).toEqual([
        { docId: `${TEAM_ID}__${TREE_ID}`, data: { currentNodeId: "node-1", updatedAt: NOW, updatedBy: MEMBER_UID } },
      ]);
    });

    it("succeeds for a genuine Team A member reporting a backward move", async () => {
      const progress = fakeProgressStore(validProgressData({ currentNodeId: "node-2" }));

      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-0", baseDeps({ progress }));

      expect(result).toEqual({ ok: true });
      expect(progress.updates[0].data.currentNodeId).toBe("node-0");
    });

    it("succeeds and still performs a write for a same-node re-report, refreshing updatedAt/updatedBy", async () => {
      const progress = fakeProgressStore(validProgressData({ currentNodeId: "node-0", updatedBy: "someone-else" }));

      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-0", baseDeps({ progress }));

      expect(result).toEqual({ ok: true });
      expect(progress.updates).toEqual([
        { docId: `${TEAM_ID}__${TREE_ID}`, data: { currentNodeId: "node-0", updatedAt: NOW, updatedBy: MEMBER_UID } },
      ]);
    });

    it("rejects an unauthenticated caller and attempts no write", async () => {
      const progress = fakeProgressStore(validProgressData());
      const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

      const result = await reportTeamSkillProgress(
        "bad-token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress, verifyToken }),
      );

      expect(result).toEqual({ ok: false, error: "unauthenticated" });
      expect(progress.updates).toHaveLength(0);
    });

    it("rejects a Team A member supplying Team B's teamId and attempts no write", async () => {
      const progress = fakeProgressStore(validProgressData({ teamId: OTHER_TEAM_ID }));
      // The caller's real membership is for TEAM_ID only.
      const membershipReader = fakeMembershipReader(validMembershipData({ teamId: TEAM_ID }));

      const result = await reportTeamSkillProgress(
        "token",
        OTHER_TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress, membershipReader }),
      );

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(progress.updates).toHaveLength(0);
    });

    it("rejects an app admin with no real membership record — admin status alone is never sufficient (BR-1)", async () => {
      const progress = fakeProgressStore(validProgressData());
      const verifyToken = verifyTokenReturning(verifiedIdentity({ email: ADMIN_EMAIL }));
      const membershipReader = fakeMembershipReader(undefined);

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress, verifyToken, membershipReader }),
      );

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(progress.updates).toHaveLength(0);
    });

    it("succeeds for an app admin who is also a genuine member — via membership, not admin status", async () => {
      const progress = fakeProgressStore(validProgressData());
      const verifyToken = verifyTokenReturning(verifiedIdentity({ uid: "admin-1", email: ADMIN_EMAIL }));
      const membershipReader = fakeMembershipReader(validMembershipData({ uid: "admin-1" }));

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress, verifyToken, membershipReader }),
      );

      expect(result).toEqual({ ok: true });
      expect(progress.updates[0].data.updatedBy).toBe("admin-1");
    });

    it("rejects a missing membership record and attempts no write", async () => {
      const progress = fakeProgressStore(validProgressData());

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress, membershipReader: fakeMembershipReader(undefined) }),
      );

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(progress.updates).toHaveLength(0);
    });

    it("rejects a malformed membership record and attempts no write", async () => {
      const progress = fakeProgressStore(validProgressData());

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress, membershipReader: fakeMembershipReader({ uid: MEMBER_UID }) }),
      );

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(progress.updates).toHaveLength(0);
    });

    it("rejects a wrong-scope membership record (different teamId) and attempts no write", async () => {
      const progress = fakeProgressStore(validProgressData());

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress, membershipReader: fakeMembershipReader(validMembershipData({ teamId: OTHER_TEAM_ID })) }),
      );

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(progress.updates).toHaveLength(0);
    });

    it("fails closed when the membership read itself throws, and attempts no write", async () => {
      const progress = fakeProgressStore(validProgressData());
      const membershipReader: MembershipReader = {
        getMembership: vi.fn().mockRejectedValue(new Error("simulated outage")),
      };

      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress, membershipReader }));

      expect(result).toEqual({ ok: false, error: "persistence_failed" });
      expect(progress.updates).toHaveLength(0);
    });

    it("re-derives membership fresh, rejecting a membership revoked between an earlier check and this call", async () => {
      // Simulates page-load-time membership having existed, then being gone by call time.
      const progress = fakeProgressStore(validProgressData());
      const membershipReader = fakeMembershipReader(undefined);

      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress, membershipReader }));

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(progress.updates).toHaveLength(0);
    });
  });

  describe("team status", () => {
    it("proceeds for an active team", async () => {
      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps());
      expect(result).toEqual({ ok: true });
    });

    it("rejects a disabled team with team_disabled, zero writes, proving the teams read occurred", async () => {
      const progress = fakeProgressStore(validProgressData());
      const getTeamStatus = vi.fn().mockResolvedValue("disabled");

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress, teamStatusReader: { getTeamStatus } }),
      );

      expect(result).toEqual({ ok: false, error: "team_disabled" });
      expect(progress.updates).toHaveLength(0);
      expect(getTeamStatus).toHaveBeenCalledWith(TEAM_ID);
      expect(getTeamStatus).toHaveBeenCalledTimes(1);
    });

    it("rejects a missing team (undefined status) with team_disabled, zero writes", async () => {
      const progress = fakeProgressStore(validProgressData());

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress, teamStatusReader: fakeTeamStatusReader(undefined) }),
      );

      expect(result).toEqual({ ok: false, error: "team_disabled" });
      expect(progress.updates).toHaveLength(0);
    });

    it("rejects a malformed team status with team_disabled, zero writes", async () => {
      const progress = fakeProgressStore(validProgressData());

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress, teamStatusReader: fakeTeamStatusReader("not-a-real-status") }),
      );

      expect(result).toEqual({ ok: false, error: "team_disabled" });
      expect(progress.updates).toHaveLength(0);
    });

    it("fails closed when the team-status read itself throws, and attempts no write", async () => {
      const progress = fakeProgressStore(validProgressData());
      const teamStatusReader: TeamStatusReader = {
        getTeamStatus: vi.fn().mockRejectedValue(new Error("simulated outage")),
      };

      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress, teamStatusReader }));

      expect(result).toEqual({ ok: false, error: "persistence_failed" });
      expect(progress.updates).toHaveLength(0);
    });

    it("never reads team/progress/tree when membership fails first (ordering)", async () => {
      const getTeamStatus = vi.fn().mockResolvedValue("active");
      const progressGet = vi.fn();
      const treeGet = vi.fn();

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({
          membershipReader: fakeMembershipReader(undefined),
          teamStatusReader: { getTeamStatus },
          progress: { get: progressGet, update: vi.fn() },
          treeReader: { get: treeGet },
        }),
      );

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(getTeamStatus).not.toHaveBeenCalled();
      expect(progressGet).not.toHaveBeenCalled();
      expect(treeGet).not.toHaveBeenCalled();
    });

    it("never reads progress/tree when the team is disabled (ordering)", async () => {
      const progressGet = vi.fn();
      const treeGet = vi.fn();

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({
          teamStatusReader: fakeTeamStatusReader("disabled"),
          progress: { get: progressGet, update: vi.fn() },
          treeReader: { get: treeGet },
        }),
      );

      expect(result).toEqual({ ok: false, error: "team_disabled" });
      expect(progressGet).not.toHaveBeenCalled();
      expect(treeGet).not.toHaveBeenCalled();
    });
  });

  describe("existing progress", () => {
    it("rejects an untracked pair (missing progress) with not_tracked, zero writes", async () => {
      const progress = fakeProgressStore(undefined);

      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

      expect(result).toEqual({ ok: false, error: "not_tracked" });
      expect(progress.updates).toHaveLength(0);
    });

    it("rejects a malformed persisted progress document with not_tracked, zero writes", async () => {
      const progress = fakeProgressStore({ teamId: TEAM_ID, treeId: TREE_ID }); // missing currentNodeId/updatedAt/updatedBy

      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

      expect(result).toEqual({ ok: false, error: "not_tracked" });
      expect(progress.updates).toHaveLength(0);
    });

    it("rejects a persisted teamId mismatch with not_tracked, zero writes", async () => {
      const progress = fakeProgressStore(validProgressData({ teamId: OTHER_TEAM_ID }));

      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

      expect(result).toEqual({ ok: false, error: "not_tracked" });
      expect(progress.updates).toHaveLength(0);
    });

    it("rejects a persisted treeId mismatch with not_tracked, zero writes", async () => {
      const progress = fakeProgressStore(validProgressData({ treeId: "some-other-tree" }));

      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

      expect(result).toEqual({ ok: false, error: "not_tracked" });
      expect(progress.updates).toHaveLength(0);
    });

    it("never reads the tree when the progress record is not_tracked (ordering)", async () => {
      const treeGet = vi.fn();

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress: fakeProgressStore(undefined), treeReader: { get: treeGet } }),
      );

      expect(result).toEqual({ ok: false, error: "not_tracked" });
      expect(treeGet).not.toHaveBeenCalled();
    });
  });

  describe("tree and node validation", () => {
    it("rejects a missing tree with tree_not_found, zero writes", async () => {
      const progress = fakeProgressStore(validProgressData());

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress, treeReader: fakeTreeReader(undefined) }),
      );

      expect(result).toEqual({ ok: false, error: "tree_not_found" });
      expect(progress.updates).toHaveLength(0);
    });

    it("rejects a malformed tree with tree_not_found, zero writes", async () => {
      const progress = fakeProgressStore(validProgressData());

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress, treeReader: fakeTreeReader({ name: "Container adoption" }) }),
      );

      expect(result).toEqual({ ok: false, error: "tree_not_found" });
      expect(progress.updates).toHaveLength(0);
    });

    it("rejects a nodeId foreign to the tree with invalid_input, zero writes", async () => {
      const progress = fakeProgressStore(validProgressData());

      const result = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-from-another-tree",
        baseDeps({ progress }),
      );

      expect(result).toEqual({ ok: false, error: "invalid_input" });
      expect(progress.updates).toHaveLength(0);
    });

    it("rejects a non-string nodeId with invalid_input, zero writes", async () => {
      const progress = fakeProgressStore(validProgressData());

      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, 42, baseDeps({ progress }));

      expect(result).toEqual({ ok: false, error: "invalid_input" });
      expect(progress.updates).toHaveLength(0);
    });

    it("never writes when the nodeId is invalid (ordering)", async () => {
      const progress = fakeProgressStore(validProgressData());

      await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "unknown-node", baseDeps({ progress }));

      expect(progress.updates).toHaveLength(0);
    });
  });

  describe("persistence and write shape", () => {
    it("writes exactly {currentNodeId, updatedAt, updatedBy} on every success path", async () => {
      const progress = fakeProgressStore(validProgressData());

      await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

      expect(Object.keys(progress.updates[0].data)).toEqual(["currentNodeId", "updatedAt", "updatedBy"]);
    });

    it("always sets updatedBy to the verified caller's uid, ignoring any request-shaped override", async () => {
      const progress = fakeProgressStore(validProgressData());
      const identity = verifiedIdentity({ uid: "member-2", email: "second-member@example.com" });

      await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({
          progress,
          verifyToken: verifyTokenReturning(identity),
          membershipReader: fakeMembershipReader(validMembershipData({ uid: "member-2" })),
        }),
      );

      // The function's own signature has no teamId/treeId/updatedBy body
      // parameter — there is nothing for a caller to override these with.
      expect(progress.updates[0].data.updatedBy).toBe("member-2");
      expect(progress.updates[0].docId).toBe(`${TEAM_ID}__${TREE_ID}`);
    });

    it("reports persistence_failed, not partial success, when the final write fails", async () => {
      const progress: SkillProgressDocStore = {
        get: vi.fn().mockResolvedValue({ exists: true, data: () => validProgressData() }),
        update: vi.fn().mockRejectedValue(new Error("simulated outage")),
      };

      const result = await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress }));

      expect(result).toEqual({ ok: false, error: "persistence_failed" });
    });

    it("never logs on any path", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps());

      const failingProgress: SkillProgressDocStore = {
        get: vi.fn().mockResolvedValue({ exists: true, data: () => validProgressData() }),
        update: vi.fn().mockRejectedValue(new Error("simulated outage")),
      };
      await reportTeamSkillProgress("token", TEAM_ID, TREE_ID, "node-1", baseDeps({ progress: failingProgress }));

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe("BR-9 regression: getTeamSkillProgress DTO shape is unaffected by a member-authored write", () => {
    it("returns no updatedBy/updatedAt/createdAt/createdBy after a member-authored write, same shape as an admin-authored one", async () => {
      // Shared in-memory store: reportTeamSkillProgress writes into it, then
      // the real, unmodified getTeamSkillProgress reads it back.
      const store = new Map<string, Record<string, unknown>>();
      store.set(`${TEAM_ID}__${TREE_ID}`, validProgressData({ updatedBy: "original-admin" }));

      const progressStore: SkillProgressDocStore = {
        async get(docId) {
          const data = store.get(docId);
          return { exists: data !== undefined, data: () => data };
        },
        async update(docId, data) {
          const existing = store.get(docId) ?? {};
          store.set(docId, { ...existing, ...data });
        },
      };

      const reportResult = await reportTeamSkillProgress(
        "token",
        TEAM_ID,
        TREE_ID,
        "node-1",
        baseDeps({ progress: progressStore }),
      );
      expect(reportResult).toEqual({ ok: true });

      const getProgressReader: GetSkillProgressReader = {
        async listRawForTeam(teamId) {
          const docs: RawSkillProgressDoc[] = [];
          for (const [id, data] of store.entries()) {
            if ((data as Record<string, unknown>).teamId === teamId) {
              docs.push({ id, data });
            }
          }
          return docs;
        },
      };
      const getTreeReader: GetSkillTreeReader = {
        async get() {
          return { exists: true, data: () => validTreeData() };
        },
      };
      const authCollection: AuthorizeTeamAccessCollection = {
        async getTeamStatus() {
          return "active";
        },
        async getMembership() {
          return validMembershipData();
        },
      };

      const readResult = await getTeamSkillProgress("token", TEAM_ID, {
        verifyToken: verifyTokenReturning(verifiedIdentity()),
        progressReader: getProgressReader,
        treeReader: getTreeReader,
        authCollection,
      });

      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      expect(readResult.skills).toHaveLength(1);
      const skill = readResult.skills[0];
      expect(skill.currentNodeId).toBe("node-1");
      expect(skill).not.toHaveProperty("updatedBy");
      expect(skill).not.toHaveProperty("updatedAt");
      expect(skill).not.toHaveProperty("createdBy");
      expect(skill).not.toHaveProperty("createdAt");
      expect(JSON.stringify(skill)).not.toContain(MEMBER_UID);
    });
  });
});
