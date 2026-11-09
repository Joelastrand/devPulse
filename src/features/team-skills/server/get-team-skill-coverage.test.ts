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
  createGetTeamSkillLevels,
  type GetTeamSkillLevelsDeps,
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
  lead: { uid: "u-lead", email: "lead@example.com", role: "teamadmin" },
  leadAdmin: { uid: "u-ladmin", email: ADMIN_EMAIL, role: "teamadmin" },
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
      { id: membershipDocId("u-ladmin", TEAM), data: { uid: "u-ladmin", teamId: TEAM, role: "teamadmin" } },
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

// ---------------------------------------------------------------------------------------------------------------------
// Internal numeric team level (Amendment A, on-demand). Same boundary as coverage: this file is the approved test sibling.
// ---------------------------------------------------------------------------------------------------------------------

const numTree = (name: string) => ({
  name,
  nodes: [
    { nodeId: "node-0", label: "A", order: 0 },
    { nodeId: "node-1", label: "B", order: 1 },
  ],
  createdAt: WHEN,
  createdBy: "admin",
});
const numNeed = (treeId: string, requiredLevel: 2 | 3 | 4 = 3) => {
  const data: SkillNeedRecord = { teamId: TEAM, treeId, requiredLevel, requiredCoverage: 2, createdAt: WHEN, updatedAt: WHEN };
  return { id: skillNeedDocId(TEAM, treeId), data: data as unknown };
};
const numContributing = (uid: string, extra: Record<string, unknown> = {}) => membership(uid, extra);
const numNotContributing = (uid: string) => ({
  id: membershipDocId(uid, TEAM),
  data: { uid, teamId: TEAM, role: "member", memberRef: `ref-${uid}` } as unknown,
});

interface NumFixture {
  signedIn?: boolean;
  member?: boolean;
  teamStatus?: unknown;
  needs?: Array<{ id: string; data: unknown }>;
  trees?: Record<string, unknown>;
  memberships?: Array<{ id: string; data: unknown }>;
  /** Personal levels per uid and tree; returned only for the uids the reader is asked for. */
  levelsByUid?: Record<string, Record<string, number>>;
  failNeeds?: boolean;
  failScan?: boolean;
  failTree?: boolean;
  failLevels?: boolean;
  throwLevels?: boolean;
  minContributors?: number;
}

function buildNumeric(f: NumFixture) {
  const reads = {
    async getTeamStatus() {
      return "teamStatus" in f ? f.teamStatus : "active";
    },
    async getMembership(uid: string, teamId: string) {
      return (f.member ?? true) ? { uid, teamId, role: "member" } : undefined;
    },
  };
  const needsReader: SkillNeedsReader = {
    async listByTeam(_teamId, limit) {
      if (f.failNeeds) throw new Error("boom");
      return (f.needs ?? []).slice(0, limit);
    },
  };
  const catalogReader: SkillNeedCatalogReader = {
    async listOrderedByCreatedAt() {
      throw new Error("catalog list must not be used");
    },
    async getSkillTree(treeId) {
      if (f.failTree) throw new Error("boom");
      return f.trees?.[treeId];
    },
  };
  const contributionStore = {
    async listMembershipsForCoverage(_teamId: string, limit: number) {
      if (f.failScan) throw new Error("boom");
      return (f.memberships ?? []).slice(0, limit);
    },
  } as unknown as SkillContributionStore;
  const readLevels = vi.fn<ReadSkillLevels>(async (uids, treeIds) => {
    if (f.throwLevels) throw new Error("boom");
    if (f.failLevels) return { ok: false };
    const levelsByTree = new Map(treeIds.map((treeId) => [treeId, [] as number[]]));
    for (const uid of uids) {
      for (const treeId of treeIds) {
        const level = f.levelsByUid?.[uid]?.[treeId];
        if (level !== undefined) levelsByTree.get(treeId)?.push(level);
      }
    }
    return { ok: true, levelsByTree };
  });
  const deps: GetTeamSkillLevelsDeps = {
    readLevels,
    verifyToken: vi.fn(async () => {
      if (f.signedIn === false) throw new Error("bad token");
      return { uid: "u-member", email: "member@example.com", email_verified: true } as never;
    }),
    reads,
    needsStore: getDefaultSkillNeedsStore(needsReader),
    catalogReader,
    contributionStore,
    ...(f.minContributors === undefined ? {} : { minContributors: f.minContributors }),
  };
  return { call: () => createGetTeamSkillLevels(deps)("token", TEAM), readLevels };
}

/** Five contributors; levels 1,3,3,3,4 → sum 14, n 5 → 2.8 → 3. */
const NUM_FIVE = ["a", "b", "c", "d", "e"];
const numBase = (over: NumFixture = {}): NumFixture => ({
  needs: [numNeed("t1")],
  trees: { t1: numTree("Alpha") },
  memberships: NUM_FIVE.map((s) => numContributing(`u-${s}`)),
  levelsByUid: { "u-a": { t1: 1 }, "u-b": { t1: 3 }, "u-c": { t1: 3 }, "u-d": { t1: 3 }, "u-e": { t1: 4 } },
  ...over,
});

describe("numeric team level: authorization", () => {
  it("refuses a signed-out caller without reading any level", async () => {
    const { call, readLevels } = buildNumeric(numBase({ signedIn: false }));
    expect((await call()).ok).toBe(false);
    expect(readLevels).not.toHaveBeenCalled();
  });

  it("refuses a non-member as forbidden", async () => {
    expect(await buildNumeric(numBase({ member: false })).call()).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses a member of a disabled team as team_disabled", async () => {
    expect(await buildNumeric(numBase({ teamStatus: "disabled" })).call()).toEqual({ ok: false, error: "team_disabled" });
  });
});

describe("numeric team level: eligible contributors", () => {
  it("evaluates the rounded mean of the five eligible contributors", async () => {
    expect(await buildNumeric(numBase()).call()).toMatchObject({
      ok: true,
      availability: "available",
      rows: [{ state: "value", level: 3 }],
    });
  });

  it("never passes a non-contributor's level into the derivation", async () => {
    const f = numBase({
      memberships: [
        ...NUM_FIVE.slice(0, 3).map((s) => numContributing(`u-${s}`)),
        numNotContributing("u-x"),
        numNotContributing("u-y"),
      ],
      levelsByUid: { "u-a": { t1: 4 }, "u-b": { t1: 4 }, "u-c": { t1: 4 }, "u-x": { t1: 1 }, "u-y": { t1: 1 } },
      minContributors: 3,
    });
    expect(await buildNumeric(f).call()).toMatchObject({ ok: true, rows: [{ state: "value", level: 4 }] });
  });

  it("excludes a membership whose notice version is stale", async () => {
    // Four at 4 plus one stale at 1: counting the stale member gives 3.4 → 3, so 4 proves exclusion.
    const f = numBase({
      memberships: [
        ...NUM_FIVE.slice(0, 4).map((s) => numContributing(`u-${s}`)),
        numContributing("u-stale", { skillContribution: { noticeVersion: 0, consentedAt: WHEN } }),
      ],
      levelsByUid: { "u-a": { t1: 4 }, "u-b": { t1: 4 }, "u-c": { t1: 4 }, "u-d": { t1: 4 }, "u-stale": { t1: 1 } },
      minContributors: 3,
    });
    expect(await buildNumeric(f).call()).toMatchObject({ ok: true, rows: [{ state: "value", level: 4 }] });
  });

  it("reflects an opt-out on the next read, with no cached value", async () => {
    const f = numBase({
      memberships: ["a", "b", "c"].map((s) => numContributing(`u-${s}`)),
      levelsByUid: { "u-a": { t1: 4 }, "u-b": { t1: 4 }, "u-c": { t1: 1 } },
      minContributors: 3,
    });
    expect(await buildNumeric(f).call()).toMatchObject({ ok: true, rows: [{ state: "value", level: 3 }] });
    const afterOptOut = await buildNumeric({
      ...f,
      memberships: [numContributing("u-a"), numContributing("u-b"), numNotContributing("u-c")],
    }).call();
    expect(afterOptOut).toMatchObject({ ok: true, rows: [{ state: "insufficient_data" }] });
  });
});

describe("numeric team level: threshold", () => {
  it("uses the owner-approved default k = 3: three contributors give a value with no caller threshold", async () => {
    // Levels 1, 3, 3 → mean 2.33 → 2.
    const f = numBase({ memberships: ["a", "b", "c"].map((s) => numContributing(`u-${s}`)) });
    expect(await buildNumeric(f).call()).toMatchObject({ ok: true, rows: [{ state: "value", level: 2 }] });
  });

  it("returns insufficient_data for two contributors under the default k = 3", async () => {
    const f = numBase({ memberships: ["a", "b"].map((s) => numContributing(`u-${s}`)) });
    expect(await buildNumeric(f).call()).toMatchObject({ ok: true, rows: [{ state: "insufficient_data" }] });
  });

  it("evaluates three contributors when the threshold is three", async () => {
    // Levels 1, 3, 3 → mean 2.33 → 2.
    const f = numBase({ memberships: ["a", "b", "c"].map((s) => numContributing(`u-${s}`)), minContributors: 3 });
    expect(await buildNumeric(f).call()).toMatchObject({ ok: true, rows: [{ state: "value", level: 2 }] });
  });

  it("returns insufficient_data, never zero, for an area with no contributor", async () => {
    expect(await buildNumeric(numBase({ levelsByUid: {}, minContributors: 3 })).call()).toMatchObject({
      ok: true,
      rows: [{ state: "insufficient_data" }],
    });
  });
});

describe("numeric team level: response shape", () => {
  it("returns only allow-listed keys per row, with no count, identity or coverage field", async () => {
    const result = await buildNumeric(numBase()).call();
    if (!result.ok || result.availability !== "available") throw new Error("expected available");
    for (const row of result.rows) {
      expect(Object.keys(row).sort()).toEqual(["areaName", "level", "state", "targetLevel", "treeId"]);
    }
    expect(JSON.stringify(result)).not.toMatch(/u-[a-e]|requiredCoverage|ref-|memberRef|contributor/);
  });

  it("omits the level key on an insufficient_data row", async () => {
    const result = await buildNumeric(numBase({ memberships: ["a", "b"].map((s) => numContributing(`u-${s}`)) })).call();
    if (!result.ok || result.availability !== "available") throw new Error("expected available");
    expect(Object.keys(result.rows[0] ?? {})).not.toContain("level");
  });

  it("returns an area_unavailable row with a null name and no level", async () => {
    expect(await buildNumeric(numBase({ trees: {} })).call()).toMatchObject({
      ok: true,
      rows: [{ state: "area_unavailable", areaName: null, treeId: "t1" }],
    });
  });

  it("returns incomplete with no rows when the cohort exceeds the scan bound", async () => {
    const many = Array.from({ length: TEAM_SKILL_COHORT_SCAN_MAX + 1 }, (_, i) => numContributing(`u-${i}`));
    expect(await buildNumeric(numBase({ memberships: many })).call()).toEqual({
      ok: true,
      availability: "incomplete",
      rows: [],
    });
  });
});

describe("numeric team level: read failures", () => {
  it.each([
    ["needs", { failNeeds: true }],
    ["membership scan", { failScan: true }],
    ["catalog tree", { failTree: true }],
    ["level read not ok", { failLevels: true }],
    ["level read throws", { throwLevels: true }],
  ] as const)("returns read_failed with no rows when the %s read fails", async (_label, over) => {
    expect(await buildNumeric(numBase(over)).call()).toEqual({ ok: false, error: "read_failed" });
  });

  it("returns read_failed, never zero, when a stored level is malformed", async () => {
    const f = numBase({
      levelsByUid: { "u-a": { t1: 0 }, "u-b": { t1: 3 }, "u-c": { t1: 3 }, "u-d": { t1: 3 }, "u-e": { t1: 4 } },
    });
    expect(await buildNumeric(f).call()).toEqual({ ok: false, error: "read_failed" });
  });
});
