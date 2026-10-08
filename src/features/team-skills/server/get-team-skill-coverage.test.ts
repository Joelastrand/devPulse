import { describe, expect, it, vi } from "vitest";
import { membershipDocId } from "../../teams/domain/team-membership";
import {
  SKILL_CONTRIBUTION_NOTICE_VERSION,
  SKILL_COVERAGE_MIN_CONTRIBUTORS,
  TEAM_SKILL_COHORT_SCAN_MAX,
} from "../domain/skill-coverage-policy";
import { skillNeedDocId, type SkillNeedRecord } from "../domain/skill-need";
import {
  createGetTeamSkillCoverage,
  type GetTeamSkillCoverageDeps,
  type GetTeamSkillCoverageResult,
  type ReadSkillLevels,
} from "./get-team-skill-coverage";
import type { SkillContributionStore } from "./skill-contribution-store";
import type { SkillNeedCatalogReader } from "./skill-need-catalog";
import { getDefaultSkillNeedsStore, type SkillNeedsReader } from "./skill-needs-store";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const TEAM = "team-1";
const ADMIN_EMAIL = "admin@example.com";
const WHEN = new Date("2026-02-01T00:00:00Z");
const CONSENT_SENTINEL = new Date("2031-05-05T05:05:05.000Z");

type Caller = "member" | "lead" | "leadAdmin" | "nonMemberAdmin" | "unrelated";
const CALLERS: Record<Caller, { uid: string; email: string; role?: string }> = {
  member: { uid: "u-member", email: "member@example.com", role: "member" },
  lead: { uid: "u-lead", email: "lead@example.com", role: "lead" },
  leadAdmin: { uid: "u-ladmin", email: ADMIN_EMAIL, role: "lead" },
  nonMemberAdmin: { uid: "u-nadmin", email: ADMIN_EMAIL },
  unrelated: { uid: "u-other", email: "other@example.com" },
};

const validTree = (name: string) => ({
  name,
  nodes: [
    { nodeId: "node-0", label: "A", order: 0 },
    { nodeId: "node-1", label: "B", order: 1 },
  ],
  createdAt: WHEN,
  createdBy: "admin",
});

const need = (treeId: string, requiredLevel: 2 | 3 | 4 = 3, requiredCoverage = 2) => {
  const data: SkillNeedRecord = { teamId: TEAM, treeId, requiredLevel, requiredCoverage, createdAt: WHEN, updatedAt: WHEN };
  return { id: skillNeedDocId(TEAM, treeId), data: data as unknown };
};

const consent = (version: number = SKILL_CONTRIBUTION_NOTICE_VERSION) => ({
  skillContribution: { noticeVersion: version, consentedAt: CONSENT_SENTINEL },
});
const membership = (uid: string, extra: Record<string, unknown> = {}, teamId = TEAM) => ({
  id: membershipDocId(uid, teamId),
  data: { uid, teamId, role: "member", memberRef: `ref-${uid}`, ...consent(), ...extra } as unknown,
});

interface Setup {
  caller?: Caller | "signedOut";
  teamStatus?: unknown;
  needs?: Array<{ id: string; data: unknown }>;
  trees?: Record<string, unknown>;
  memberships?: Array<{ id: string; data: unknown }>;
  levels?: Record<string, number[]>;
  failNeeds?: boolean;
  failScan?: boolean;
  failTree?: boolean;
  failLevels?: boolean;
}

function setup(s: Setup) {
  const callerKey = s.caller ?? "member";
  const caller = callerKey === "signedOut" ? undefined : CALLERS[callerKey];
  const reads = {
    async getTeamStatus() {
      return "teamStatus" in s ? s.teamStatus : "active";
    },
    async getMembership(uid: string, teamId: string) {
      const entry = Object.values(CALLERS).find((c) => c.uid === uid);
      return entry?.role ? { uid, teamId, role: entry.role } : undefined;
    },
  };
  const reader: SkillNeedsReader = {
    async listByTeam(_teamId, limit) {
      if (s.failNeeds) throw new Error("boom");
      return (s.needs ?? []).slice(0, limit);
    },
  };
  const catalogReader: SkillNeedCatalogReader = {
    async listOrderedByCreatedAt() {
      throw new Error("catalog list must not be used");
    },
    async getSkillTree(treeId) {
      if (s.failTree) throw new Error("boom");
      return s.trees?.[treeId];
    },
  };
  const listMembershipsForCoverage = vi.fn(async (_teamId: string, limit: number) => {
    if (s.failScan) throw new Error("boom");
    return (s.memberships ?? []).slice(0, limit);
  });
  // No transaction method: any write path would throw and surface as read_failed.
  const contributionStore = { listMembershipsForCoverage } as unknown as SkillContributionStore;
  const readLevels = vi.fn<ReadSkillLevels>(async (_uids, treeIds) => {
    if (s.failLevels) return { ok: false };
    return { ok: true, levelsByTree: new Map(treeIds.map((t) => [t, s.levels?.[t] ?? []])) };
  });
  const deps: GetTeamSkillCoverageDeps = {
    readLevels,
    verifyToken: vi.fn(async () => {
      if (!caller) throw new Error("bad token");
      return { uid: caller.uid, email: caller.email, email_verified: true } as never;
    }),
    reads,
    needsStore: getDefaultSkillNeedsStore(reader),
    catalogReader,
    contributionStore,
  };
  return { call: () => createGetTeamSkillCoverage(deps)("token", TEAM), readLevels, listMembershipsForCoverage };
}

const FIVE = ["a", "b", "c", "d", "e"].map((s) => membership(`u-${s}`));
const base = (over: Setup = {}): Setup => ({
  needs: [need("t1")],
  trees: { t1: validTree("Alpha") },
  memberships: FIVE,
  levels: { t1: [3, 3, 1, 1, 1] },
  ...over,
});
const statesOf = (r: GetTeamSkillCoverageResult) => (r.ok ? r.rows.map((row) => row.state) : r);

describe("authorization", () => {
  it.each(["member", "lead", "leadAdmin"] as const)("%s is served", async (caller) => {
    const { call, readLevels } = setup(base({ caller }));
    expect((await call()).ok).toBe(true);
    expect(readLevels).toHaveBeenCalledTimes(1);
  });

  it("a lead receives the same DTO as a member", async () => {
    expect(await setup(base({ caller: "lead" })).call()).toEqual(await setup(base({ caller: "member" })).call());
  });

  it.each(["nonMemberAdmin", "unrelated"] as const)("%s is forbidden with no cohort reads", async (caller) => {
    const { call, readLevels, listMembershipsForCoverage } = setup(base({ caller }));
    expect(await call()).toEqual({ ok: false, error: "forbidden" });
    expect(readLevels).not.toHaveBeenCalled();
    expect(listMembershipsForCoverage).not.toHaveBeenCalled();
  });

  it("a signed-out caller is unauthenticated", async () => {
    const { call, readLevels } = setup(base({ caller: "signedOut" }));
    expect(await call()).toEqual({ ok: false, error: "unauthenticated" });
    expect(readLevels).not.toHaveBeenCalled();
  });

  it("a disabled team is team_disabled for a member and never reaches derivation", async () => {
    const { call, readLevels, listMembershipsForCoverage } = setup(base({ teamStatus: "disabled" }));
    expect(await call()).toEqual({ ok: false, error: "team_disabled" });
    expect(readLevels).not.toHaveBeenCalled();
    expect(listMembershipsForCoverage).not.toHaveBeenCalled();
  });

  it("a non-member never learns team_disabled; a missing team is forbidden", async () => {
    expect(await setup(base({ caller: "nonMemberAdmin", teamStatus: "disabled" })).call()).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await setup(base({ teamStatus: undefined })).call()).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("threshold and categorical derivation", () => {
  it(`k is ${SKILL_COVERAGE_MIN_CONTRIBUTORS}: 0, 1 and 4 contributors are insufficient_data`, async () => {
    for (const n of [0, 1, 4]) {
      const { call } = setup(base({ levels: { t1: Array<number>(n).fill(4) } }));
      expect(statesOf(await call())).toEqual(["insufficient_data"]);
    }
  });

  it("exactly 5 and 6 contributors are evaluated", async () => {
    expect(statesOf(await setup(base({ levels: { t1: [4, 4, 4, 4, 4] } })).call())).toEqual(["covered"]);
    expect(statesOf(await setup(base({ levels: { t1: [4, 4, 1, 1, 1, 1] } })).call())).toEqual(["covered"]);
  });

  it("covered at exactly requiredCoverage at/above, gap with one fewer, gap when all are below", async () => {
    expect(statesOf(await setup(base({ levels: { t1: [3, 3, 2, 2, 2] } })).call())).toEqual(["covered"]);
    expect(statesOf(await setup(base({ levels: { t1: [3, 2, 2, 2, 2] } })).call())).toEqual(["gap"]);
    expect(statesOf(await setup(base({ levels: { t1: [1, 1, 1, 1, 1] } })).call())).toEqual(["gap"]);
  });

  it("requiredCoverage above a cohort of at least 5 is gap, not insufficient_data", async () => {
    const { call } = setup(base({ needs: [need("t1", 2, 20)], levels: { t1: [4, 4, 4, 4, 4] } }));
    expect(statesOf(await call())).toEqual(["gap"]);
  });

  it("threshold is per skill: a person unassessed in one tree does not count there", async () => {
    const { call } = setup({
      needs: [need("t1"), need("t2")],
      trees: { t1: validTree("Alpha"), t2: validTree("Beta") },
      memberships: FIVE,
      levels: { t1: [4, 4, 4, 4, 4], t2: [4, 4, 4, 4] },
    });
    const result = await call();
    expect(result.ok && result.rows.map((r) => [r.treeId, r.state])).toEqual([
      ["t1", "covered"],
      ["t2", "insufficient_data"],
    ]);
  });

  it("a sparse skill in a large team is judged by its own contributors", async () => {
    const many = Array.from({ length: 40 }, (_, i) => membership(`u-${i}`));
    expect(statesOf(await setup(base({ memberships: many, levels: { t1: [4, 4] } })).call())).toEqual([
      "insufficient_data",
    ]);
  });
});

describe("eligible uid set handed to the reader", () => {
  const readerCalls = async (s: Setup) => {
    const { call, readLevels } = setup(s);
    await call();
    return readLevels.mock.calls.map(([uids, trees]) => [[...uids].sort(), [...trees]]);
  };

  it("contains exactly the genuine, effectively consenting members of this team", async () => {
    const memberships = [
      membership("u-ok1"),
      membership("u-ok2"),
      membership("u-stale", consent(SKILL_CONTRIBUTION_NOTICE_VERSION + 1)),
      membership("u-old", consent(0)),
      membership("u-none", { skillContribution: undefined }),
      membership("u-enabled", { skillContribution: { enabled: true } }),
      membership("u-extra", { skillContribution: { noticeVersion: 1, consentedAt: WHEN, enabled: false } }),
      membership("u-badstamp", { skillContribution: { noticeVersion: 1, consentedAt: "x" } }),
      membership("u-foreign", {}, "team-2"),
      { id: membershipDocId("u-ok1", "team-2"), data: { uid: "u-ok1", teamId: "team-2", ...consent() } },
      { id: "wrong-id", data: { uid: "u-wrongid", teamId: TEAM, ...consent() } },
      { id: membershipDocId("", TEAM), data: { uid: "", teamId: TEAM, ...consent() } },
      { id: "x", data: null },
      { id: membershipDocId("u-ladmin", TEAM), data: { uid: "u-ladmin", teamId: TEAM, role: "lead" } },
    ];
    expect(await readerCalls(base({ memberships }))).toEqual([[["u-ok1", "u-ok2"], ["t1"]]]);
  });

  it("collapses a duplicated person", async () => {
    const dup = membership("u-dup");
    expect(await readerCalls(base({ memberships: [dup, dup, membership("u-b")] }))).toEqual([
      [["u-b", "u-dup"], ["t1"]],
    ]);
  });

  it("requests only the valid needed trees, in one call", async () => {
    const s = base({
      needs: [need("t1"), need("t2"), need("t3")],
      trees: { t1: validTree("Alpha"), t3: validTree("Gamma"), t2: { name: "" } },
    });
    expect(await readerCalls(s)).toEqual([[["u-a", "u-b", "u-c", "u-d", "u-e"], ["t1", "t3"]]]);
  });

  it("is not called when nobody effectively participates", async () => {
    const { call, readLevels } = setup(base({ memberships: [membership("u-x", { skillContribution: undefined })] }));
    expect(statesOf(await call())).toEqual(["insufficient_data"]);
    expect(readLevels).not.toHaveBeenCalled();
  });
});

describe("integrity and completeness", () => {
  it("missing and malformed trees are area_unavailable, independent of cohort size, and not requested", async () => {
    for (const memberships of [[], FIVE]) {
      const { call, readLevels } = setup({
        needs: [need("t1"), need("t2"), need("t3")],
        trees: { t1: validTree("Alpha"), t2: { name: 5 } },
        memberships,
        levels: { t1: [4, 4, 4, 4, 4] },
      });
      const result = await call();
      expect(result.ok && result.rows.filter((r) => r.state === "area_unavailable")).toEqual([
        { treeId: "t2", areaName: null, requiredLevel: 3, requiredCoverage: 2, state: "area_unavailable" },
        { treeId: "t3", areaName: null, requiredLevel: 3, requiredCoverage: 2, state: "area_unavailable" },
      ]);
      for (const [, trees] of readLevels.mock.calls) expect(trees).toEqual(["t1"]);
    }
  });

  it("skips invalid need documents", async () => {
    const bad = need("t2");
    (bad.data as Record<string, unknown>).requiredLevel = 9;
    const { call } = setup(base({ needs: [need("t1"), bad, { id: "junk", data: 5 }] }));
    const result = await call();
    expect(result.ok && result.rows.map((r) => r.treeId)).toEqual(["t1"]);
  });

  it("no needs ⇒ empty available response with no membership scan or profile read", async () => {
    const { call, readLevels, listMembershipsForCoverage } = setup(base({ needs: [] }));
    expect(await call()).toEqual({ ok: true, availability: "available", rows: [] });
    expect(readLevels).not.toHaveBeenCalled();
    expect(listMembershipsForCoverage).not.toHaveBeenCalled();
  });

  it("evaluates exactly the scan bound of memberships", async () => {
    const many = Array.from({ length: TEAM_SKILL_COHORT_SCAN_MAX }, (_, i) => membership(`u-${i}`));
    const { call, readLevels, listMembershipsForCoverage } = setup(base({ memberships: many }));
    expect((await call()).ok).toBe(true);
    expect(listMembershipsForCoverage).toHaveBeenCalledWith(TEAM, TEAM_SKILL_COHORT_SCAN_MAX + 1);
    expect(readLevels.mock.calls[0]?.[0]).toHaveLength(TEAM_SKILL_COHORT_SCAN_MAX);
  });

  it("one membership past the bound ⇒ incomplete, no rows, no reader call", async () => {
    const many = Array.from({ length: TEAM_SKILL_COHORT_SCAN_MAX + 1 }, (_, i) => membership(`u-${i}`));
    const { call, readLevels } = setup(base({ memberships: many }));
    expect(await call()).toEqual({ ok: true, availability: "incomplete", rows: [] });
    expect(readLevels).not.toHaveBeenCalled();
  });
});

describe("failures are read_failed, never partial or insufficient_data", () => {
  it.each(["failNeeds", "failScan", "failTree", "failLevels"] as const)("%s", async (flag) => {
    expect(await setup(base({ [flag]: true })).call()).toEqual({ ok: false, error: "read_failed" });
  });

  it("a throwing reader is read_failed and its message does not escape", async () => {
    const s = setup(base());
    s.readLevels.mockRejectedValueOnce(new Error("uid u-a level 4"));
    expect(await s.call()).toEqual({ ok: false, error: "read_failed" });
  });
});

describe("response shape", () => {
  it("has only allow-listed keys and nothing that identifies or counts people", async () => {
    const result = await setup(base({ needs: [need("t1"), need("t2")], trees: { t1: validTree("Alpha") } })).call();
    if (!result.ok) throw new Error("expected ok");
    expect(Object.keys(result).sort()).toEqual(["availability", "ok", "rows"]);
    for (const row of result.rows) {
      expect(Object.keys(row).sort()).toEqual(["areaName", "requiredCoverage", "requiredLevel", "state", "treeId"]);
    }
    const json = JSON.stringify(result);
    for (const forbidden of ["u-a", "u-b", "ref-u-", "2031", "consentedAt", "noticeVersion", "email", "ount"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("rows are sorted by area name", async () => {
    const result = await setup(
      base({ needs: [need("t1"), need("t2")], trees: { t1: validTree("Zulu"), t2: validTree("Alpha") } }),
    ).call();
    expect(result.ok && result.rows.map((r) => r.areaName)).toEqual(["Alpha", "Zulu"]);
  });
});
