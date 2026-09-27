import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";
import type {
  GetTeamSkillProgressDeps,
  GetTeamSkillProgressDocSnapshot,
  MembershipReader,
  RawSkillProgressDoc,
  SkillProgressReader,
  SkillTreeReader,
  TeamStatusReader,
} from "./get-team-skill-progress";
import { getTeamSkillProgress } from "./get-team-skill-progress";

const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const MEMBER_UID = "member-1";
const ADMIN_EMAIL = "admin@example.com";
const TREE_ID = "tree-1";

function memberIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: MEMBER_UID, email: "dev@example.com", emailVerified: true, ...overrides };
}

function adminIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return memberIdentity({ email: ADMIN_EMAIL, ...overrides });
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function fakeAuthCollection(state: {
  teamStatus?: Record<string, unknown>;
  memberships?: Record<string, unknown>;
}): AuthorizeTeamAccessCollection {
  const teamStatus = state.teamStatus ?? {};
  const memberships = state.memberships ?? {};
  return {
    async getTeamStatus(teamId) {
      return teamStatus[teamId];
    },
    async getMembership(uid, teamId) {
      return memberships[`${uid}__${teamId}`];
    },
  };
}

function progressDoc(id: string, overrides: Record<string, unknown> = {}): RawSkillProgressDoc {
  return {
    id,
    data: {
      teamId: TEAM_ID,
      treeId: TREE_ID,
      currentNodeId: "node-0",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      updatedBy: "some-admin",
      ...overrides,
    },
  };
}

function treeData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Container adoption",
    nodes: [
      { nodeId: "node-0", label: "Container fundamentals", order: 0 },
      { nodeId: "node-1", label: "Evaluate alternatives", order: 1 },
    ],
    createdAt: new Date("2025-01-01T00:00:00Z"),
    createdBy: "original-admin",
    ...overrides,
  };
}

interface FakeProgressReader extends SkillProgressReader {
  calls: string[];
}

function fakeProgressReader(docs: RawSkillProgressDoc[]): FakeProgressReader {
  const calls: string[] = [];
  return {
    calls,
    async listRawForTeam(teamId) {
      calls.push(teamId);
      return docs;
    },
  };
}

function failingProgressReader(): SkillProgressReader {
  return { listRawForTeam: vi.fn().mockRejectedValue(new Error("simulated firestore outage")) };
}

function failingMembershipReader(): MembershipReader {
  return { getMembership: vi.fn().mockRejectedValue(new Error("simulated firestore outage")) };
}

function failingTeamStatusReader(): TeamStatusReader {
  return { getTeamStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")) };
}

/** A tree reader keyed by treeId — `undefined` for a given id means "no such document" (`exists: false`). */
function fakeTreeReader(trees: Record<string, Record<string, unknown> | undefined>): SkillTreeReader {
  return {
    async get(treeId): Promise<GetTeamSkillProgressDocSnapshot> {
      const data = trees[treeId];
      return { exists: data !== undefined, data: () => data };
    },
  };
}

/**
 * `AuthorizeTeamAccessCollection`'s `getTeamStatus`/`getMembership` shape is
 * structurally identical to `MembershipReader`/`TeamStatusReader` (both
 * defined independently in production code, per this codebase's
 * per-operation dependency-seam convention — see `get-team-skill-progress.ts`).
 * Reusing the same fake collection for all three deps here is a test-only
 * convenience, not a production coupling: `getTeamSkillProgress` never calls
 * `authorizeTeamAccess`'s own collection to compute `canReportProgress`, and
 * every test below that needs the two to diverge (e.g. an app admin with no
 * real membership) passes a distinct `membershipReader`/`teamStatusReader`
 * explicitly.
 */
function memberBaseDeps(overrides: Partial<GetTeamSkillProgressDeps> = {}): GetTeamSkillProgressDeps {
  const authCollection =
    overrides.authCollection ??
    fakeAuthCollection({
      teamStatus: { [TEAM_ID]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: { uid: MEMBER_UID, teamId: TEAM_ID } },
    });
  return {
    verifyToken: verifyTokenReturning(memberIdentity()),
    allowList: [ADMIN_EMAIL],
    authCollection,
    membershipReader: authCollection,
    teamStatusReader: authCollection,
    progressReader: fakeProgressReader([]),
    treeReader: fakeTreeReader({ [TREE_ID]: treeData() }),
    ...overrides,
  };
}

describe("getTeamSkillProgress", () => {
  describe("authorization", () => {
    it("succeeds for an authorized real team member", async () => {
      const result = await getTeamSkillProgress(
        "token",
        TEAM_ID,
        memberBaseDeps({ progressReader: fakeProgressReader([progressDoc("p1")]) }),
      );

      expect(result.ok).toBe(true);
    });

    it("succeeds for an app admin exactly per authorizeTeamAccess, even without real team membership", async () => {
      const deps = memberBaseDeps({
        verifyToken: verifyTokenReturning(adminIdentity()),
        authCollection: fakeAuthCollection({ teamStatus: { [TEAM_ID]: "active" }, memberships: {} }),
        progressReader: fakeProgressReader([progressDoc("p1")]),
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
    });

    it("rejects an unauthenticated caller, never calling the progress reader", async () => {
      const reader = fakeProgressReader([progressDoc("p1")]);
      const result = await getTeamSkillProgress(
        "bad-token",
        TEAM_ID,
        memberBaseDeps({ verifyToken: vi.fn().mockRejectedValue(new Error("invalid token")), progressReader: reader }),
      );

      expect(result).toEqual({ ok: false, error: "unauthenticated" });
      expect(reader.calls).toHaveLength(0);
    });

    it("rejects a non-member/non-admin as forbidden, never calling the progress reader (authorization happens server-side)", async () => {
      const reader = fakeProgressReader([progressDoc("p1")]);
      const deps = memberBaseDeps({
        authCollection: fakeAuthCollection({ teamStatus: { [TEAM_ID]: "active" }, memberships: {} }),
        progressReader: reader,
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(reader.calls).toHaveLength(0);
    });

    it("rejects a caller authorized only for a different team (Team A cannot read Team B's progress)", async () => {
      // The caller has a real teamMemberships record for OTHER_TEAM_ID, not
      // TEAM_ID — requesting TEAM_ID must be denied regardless.
      const reader = fakeProgressReader([progressDoc("p1")]);
      const deps = memberBaseDeps({
        authCollection: fakeAuthCollection({
          teamStatus: { [TEAM_ID]: "active", [OTHER_TEAM_ID]: "active" },
          memberships: { [`${MEMBER_UID}__${OTHER_TEAM_ID}`]: { uid: MEMBER_UID, teamId: OTHER_TEAM_ID } },
        }),
        progressReader: reader,
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(reader.calls).toHaveLength(0);
    });

    it("returns read_failed, distinct from forbidden, when the authorization check itself fails", async () => {
      const authCollection: AuthorizeTeamAccessCollection = {
        getTeamStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
        getMembership: vi.fn(),
      };
      const reader = fakeProgressReader([progressDoc("p1")]);

      const result = await getTeamSkillProgress("token", TEAM_ID, memberBaseDeps({ authCollection, progressReader: reader }));

      expect(result).toEqual({ ok: false, error: "read_failed" });
      expect(reader.calls).toHaveLength(0);
    });
  });

  describe("read behavior", () => {
    it("returns an empty list for a team tracking no skills, not an error", async () => {
      const result = await getTeamSkillProgress("token", TEAM_ID, memberBaseDeps({ progressReader: fakeProgressReader([]) }));

      expect(result).toEqual({ ok: true, skills: [], canReportProgress: true });
    });

    it("returns one tracked skill with the exact approved DTO shape", async () => {
      const result = await getTeamSkillProgress(
        "token",
        TEAM_ID,
        memberBaseDeps({ progressReader: fakeProgressReader([progressDoc("p1", { currentNodeId: "node-1" })]) }),
      );

      expect(result).toEqual({
        ok: true,
        skills: [
          {
            treeId: TREE_ID,
            name: "Container adoption",
            nodes: [
              { nodeId: "node-0", label: "Container fundamentals", order: 0 },
              { nodeId: "node-1", label: "Evaluate alternatives", order: 1 },
            ],
            currentNodeId: "node-1",
          },
        ],
        canReportProgress: true,
      });
    });

    it("returns multiple tracked skills, each resolved against its own tree", async () => {
      const secondTreeId = "tree-2";
      const deps = memberBaseDeps({
        progressReader: fakeProgressReader([
          progressDoc("p1", { treeId: TREE_ID, currentNodeId: "node-0" }),
          progressDoc("p2", { treeId: secondTreeId, currentNodeId: null }),
        ]),
        treeReader: fakeTreeReader({
          [TREE_ID]: treeData(),
          [secondTreeId]: treeData({ name: "Observability" }),
        }),
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.skills).toHaveLength(2);
        expect(result.skills.map((s) => s.treeId).sort()).toEqual([TREE_ID, secondTreeId].sort());
      }
    });

    it("includes a currentNodeId: null (not started) tree rather than dropping it", async () => {
      const result = await getTeamSkillProgress(
        "token",
        TEAM_ID,
        memberBaseDeps({ progressReader: fakeProgressReader([progressDoc("p1", { currentNodeId: null })]) }),
      );

      expect(result).toEqual({
        ok: true,
        skills: [
          {
            treeId: TREE_ID,
            name: "Container adoption",
            nodes: [
              { nodeId: "node-0", label: "Container fundamentals", order: 0 },
              { nodeId: "node-1", label: "Evaluate alternatives", order: 1 },
            ],
            currentNodeId: null,
          },
        ],
        canReportProgress: true,
      });
    });

    it("succeeds for a disabled team's existing skill progress (no team-active gate), but reports canReportProgress: false (a member cannot currently self-report on a disabled team)", async () => {
      const deps = memberBaseDeps({
        authCollection: fakeAuthCollection({
          teamStatus: { [TEAM_ID]: "disabled" },
          memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: { uid: MEMBER_UID, teamId: TEAM_ID } },
        }),
        progressReader: fakeProgressReader([progressDoc("p1")]),
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.skills).toHaveLength(1);
        expect(result.canReportProgress).toBe(false);
      }
    });

    it("queries skillProgress with exactly the requested teamId", async () => {
      const reader = fakeProgressReader([]);

      await getTeamSkillProgress("token", TEAM_ID, memberBaseDeps({ progressReader: reader }));

      expect(reader.calls).toEqual([TEAM_ID]);
    });

    it("preserves the reader's own document order deterministically (no ordering requirement is imposed)", async () => {
      const secondTreeId = "tree-2";
      const docs = [
        progressDoc("p1", { treeId: secondTreeId, currentNodeId: null }),
        progressDoc("p2", { treeId: TREE_ID, currentNodeId: "node-0" }),
      ];
      const deps = memberBaseDeps({
        progressReader: fakeProgressReader(docs),
        treeReader: fakeTreeReader({ [TREE_ID]: treeData(), [secondTreeId]: treeData({ name: "Observability" }) }),
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.skills.map((s) => s.treeId)).toEqual([secondTreeId, TREE_ID]);
      }
    });
  });

  describe("validation and fail-closed behavior", () => {
    it("excludes a malformed skillProgress record without failing the whole call", async () => {
      const malformed = progressDoc("p1", { currentNodeId: 42 }); // wrong type
      const valid = progressDoc("p2");
      const result = await getTeamSkillProgress(
        "token",
        TEAM_ID,
        memberBaseDeps({ progressReader: fakeProgressReader([malformed, valid]) }),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.skills).toHaveLength(1);
      }
    });

    it("excludes a progress record whose persisted teamId disagrees with the requested team (defense-in-depth cross-check)", async () => {
      const crossTeamDoc = progressDoc("p1", { teamId: OTHER_TEAM_ID });
      const result = await getTeamSkillProgress(
        "token",
        TEAM_ID,
        memberBaseDeps({ progressReader: fakeProgressReader([crossTeamDoc]) }),
      );

      expect(result).toEqual({ ok: true, skills: [], canReportProgress: true });
    });

    it("excludes a record whose referenced SkillTree is malformed", async () => {
      const deps = memberBaseDeps({
        progressReader: fakeProgressReader([progressDoc("p1")]),
        treeReader: fakeTreeReader({ [TREE_ID]: { name: "Container adoption" } }), // missing nodes/createdAt/createdBy
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result).toEqual({ ok: true, skills: [], canReportProgress: true });
    });

    it("excludes a record whose referenced SkillTree no longer exists", async () => {
      const deps = memberBaseDeps({
        progressReader: fakeProgressReader([progressDoc("p1")]),
        treeReader: fakeTreeReader({ [TREE_ID]: undefined }),
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result).toEqual({ ok: true, skills: [], canReportProgress: true });
    });

    it("does not invalidate a currentNodeId absent from its resolved tree's nodes — SPEC defines no such check, and this is structurally unreachable via the write-side operations", async () => {
      const deps = memberBaseDeps({
        progressReader: fakeProgressReader([progressDoc("p1", { currentNodeId: "node-does-not-exist" })]),
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.skills[0]?.currentNodeId).toBe("node-does-not-exist");
      }
    });

    it("returns read_failed when the skillProgress query itself fails, distinct from authorizeTeamAccess's own read_failed", async () => {
      const reader = failingProgressReader();

      const result = await getTeamSkillProgress("token", TEAM_ID, memberBaseDeps({ progressReader: reader }));

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });

    it("does not return partial/raw data when the skillProgress query fails", async () => {
      const reader = failingProgressReader();

      const result = await getTeamSkillProgress("token", TEAM_ID, memberBaseDeps({ progressReader: reader }));

      expect(result).toEqual({ ok: false, error: "read_failed" });
      expect("skills" in result).toBe(false);
    });

    it("fails the whole call closed with read_failed when an individual SkillTree read throws", async () => {
      const treeReader: SkillTreeReader = { get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")) };
      const deps = memberBaseDeps({ progressReader: fakeProgressReader([progressDoc("p1")]), treeReader });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });
  });

  describe("DTO minimization and privacy", () => {
    it("returns only treeId/name/nodes/currentNodeId — no updatedBy, createdBy, admin identity, or unexpected fields", async () => {
      const deps = memberBaseDeps({
        progressReader: fakeProgressReader([
          progressDoc("p1", { updatedBy: "leaked-admin-uid", extraProgressField: "unexpected" }),
        ]),
        treeReader: fakeTreeReader({
          [TREE_ID]: treeData({
            updatedAt: new Date("2026-02-01T00:00:00Z"),
            updatedBy: "leaked-admin-uid-2",
            extraTreeField: "unexpected",
          }),
        }),
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.keys(result.skills[0])).toEqual(["treeId", "name", "nodes", "currentNodeId"]);
        expect(JSON.stringify(result.skills)).not.toContain("leaked-admin-uid");
        expect(JSON.stringify(result.skills)).not.toContain("unexpected");
        expect(JSON.stringify(result.skills)).not.toContain("createdAt");
        expect(JSON.stringify(result.skills)).not.toContain("createdBy");
        expect(JSON.stringify(result.skills)).not.toContain("updatedAt");
        expect(JSON.stringify(result.skills)).not.toContain("updatedBy");
      }
    });

    it("rebuilds each node explicitly — no member/user identity field, no raw Firestore object reaches the response", async () => {
      const result = await getTeamSkillProgress(
        "token",
        TEAM_ID,
        memberBaseDeps({ progressReader: fakeProgressReader([progressDoc("p1")]) }),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const node of result.skills[0].nodes) {
          expect(Object.keys(node)).toEqual(["nodeId", "label", "order"]);
        }
      }
    });

    it("never logs on any path", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await getTeamSkillProgress("token", TEAM_ID, memberBaseDeps({ progressReader: fakeProgressReader([progressDoc("p1")]) }));
      await getTeamSkillProgress("token", TEAM_ID, memberBaseDeps({ progressReader: failingProgressReader() }));

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  /**
   * `canReportProgress` (docs/features/skill-progress-self-report/SPEC.md —
   * "Permission-UI correction"): a UI-capability signal, independent of the
   * `skills` list above and of `authorizeTeamAccess`'s broader read result —
   * re-derives the exact membership-then-team-status semantics
   * `reportTeamSkillProgress` itself requires, via its own
   * `membershipReader`/`teamStatusReader` deps.
   */
  describe("canReportProgress capability", () => {
    it("is true for a genuine member of an active team", async () => {
      const result = await getTeamSkillProgress("token", TEAM_ID, memberBaseDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.canReportProgress).toBe(true);
      }
    });

    it("is true for an app admin who is also a genuine member of an active team", async () => {
      const adminMemberUid = "admin-member-uid";
      const authCollection = fakeAuthCollection({
        teamStatus: { [TEAM_ID]: "active" },
        memberships: { [`${adminMemberUid}__${TEAM_ID}`]: { uid: adminMemberUid, teamId: TEAM_ID } },
      });
      const deps = memberBaseDeps({
        verifyToken: verifyTokenReturning(adminIdentity({ uid: adminMemberUid })),
        authCollection,
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.canReportProgress).toBe(true);
      }
    });

    it("is false for an app admin with no real team membership, even though authorizeTeamAccess grants the read (never derived from admin/read-authorization status)", async () => {
      const authCollection = fakeAuthCollection({ teamStatus: { [TEAM_ID]: "active" }, memberships: {} });
      const deps = memberBaseDeps({
        verifyToken: verifyTokenReturning(adminIdentity()),
        authCollection,
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.canReportProgress).toBe(false);
      }
    });

    it("is false when the caller has no teamMemberships record at all", async () => {
      const deps = memberBaseDeps({
        membershipReader: { async getMembership() { return undefined; } },
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.canReportProgress).toBe(false);
      }
    });

    it("is false for a malformed membership record (wrong shape)", async () => {
      const deps = memberBaseDeps({
        membershipReader: { async getMembership() { return { unexpected: "shape" }; } },
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.canReportProgress).toBe(false);
      }
    });

    it("is false for a membership record belonging to a different team (wrong-team cross-check)", async () => {
      const deps = memberBaseDeps({
        membershipReader: {
          async getMembership(uid) {
            return { uid, teamId: OTHER_TEAM_ID };
          },
        },
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.canReportProgress).toBe(false);
      }
    });

    it("fails closed to false when the membership read itself throws", async () => {
      const deps = memberBaseDeps({ membershipReader: failingMembershipReader() });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.canReportProgress).toBe(false);
      }
    });

    it("is false for a genuine member of a disabled team", async () => {
      const deps = memberBaseDeps({
        teamStatusReader: { async getTeamStatus() { return "disabled"; } },
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.canReportProgress).toBe(false);
      }
    });

    it("is false when the team's status is missing (no teams document)", async () => {
      const deps = memberBaseDeps({
        teamStatusReader: { async getTeamStatus() { return undefined; } },
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.canReportProgress).toBe(false);
      }
    });

    it("is false when the team's status is malformed/unrecognized", async () => {
      const deps = memberBaseDeps({
        teamStatusReader: { async getTeamStatus() { return "not-a-real-status"; } },
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.canReportProgress).toBe(false);
      }
    });

    it("fails closed to false when the team-status read itself throws", async () => {
      const deps = memberBaseDeps({ teamStatusReader: failingTeamStatusReader() });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.canReportProgress).toBe(false);
      }
    });

    it("still returns readable skills data (read-only) even when canReportProgress is false — read and mutation-eligibility remain independent", async () => {
      const deps = memberBaseDeps({
        teamStatusReader: { async getTeamStatus() { return "disabled"; } },
        progressReader: fakeProgressReader([progressDoc("p1")]),
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.skills).toHaveLength(1);
        expect(result.canReportProgress).toBe(false);
      }
    });

    it("never calls the membership/team-status readers for a denied (non-member/non-admin) caller", async () => {
      const membershipReader: MembershipReader = { getMembership: vi.fn() };
      const teamStatusReader: TeamStatusReader = { getTeamStatus: vi.fn() };
      const deps = memberBaseDeps({
        authCollection: fakeAuthCollection({ teamStatus: { [TEAM_ID]: "active" }, memberships: {} }),
        membershipReader,
        teamStatusReader,
      });

      const result = await getTeamSkillProgress("token", TEAM_ID, deps);

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(membershipReader.getMembership).not.toHaveBeenCalled();
      expect(teamStatusReader.getTeamStatus).not.toHaveBeenCalled();
    });
  });
});
