import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { readSkillLevelsBatch } from "../../skill-profiles/server/read-skill-levels-batch";
import { membershipDocId } from "../../teams/domain/team-membership";
import { SKILL_CONTRIBUTION_NOTICE_VERSION, SKILL_COVERAGE_MIN_CONTRIBUTORS } from "../domain/skill-coverage-policy";
import { skillNeedDocId, type SkillNeedRecord } from "../domain/skill-need";
import {
  createGetTeamSkillCoverage,
  getTeamSkillCoverage,
  type GetTeamSkillCoverageResult,
  type ReadSkillLevels,
} from "./get-team-skill-coverage";
import type { SkillContributionStore } from "./skill-contribution-store";
import type { SkillNeedCatalogReader } from "./skill-need-catalog";
import { getDefaultSkillNeedsStore, type SkillNeedsReader } from "./skill-needs-store";

// Any real Firestore/Auth use (profile writes, progress or roadmap collections, …) throws and fails the test.
vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

/**
 * End-to-end privacy matrix (C2 TASK-015): the coverage operation wired to the REAL
 * `readSkillLevelsBatch` over an injected raw reader backed by in-memory profiles.
 */

const TEAM = "team-1";
const WHEN = new Date("2026-02-01T00:00:00Z");
const CALLERS = {
  member: { uid: "u-member", email: "member@example.com", role: "member" },
  lead: { uid: "u-lead", email: "lead@example.com", role: "lead" },
  memberAdmin: { uid: "u-madmin", email: "admin@example.com", role: "member" },
  leadAdmin: { uid: "u-ladmin", email: "admin@example.com", role: "lead" },
  nonMemberAdmin: { uid: "u-nadmin", email: "admin@example.com", role: undefined },
} as const;
type Caller = keyof typeof CALLERS;

const tree = (name: string) => ({
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
  skillContribution: { noticeVersion: version, consentedAt: new Date("2031-05-05T05:05:05Z") },
});
const membership = (uid: string, extra: Record<string, unknown> = {}, teamId = TEAM) => ({
  id: membershipDocId(uid, teamId),
  data: { uid, teamId, role: "member", memberRef: `ref-${uid}`, ...consent(), ...extra } as unknown,
});

type Profiles = Record<string, Record<string, unknown> | undefined>;
interface Setup {
  caller?: Caller;
  teamStatus?: unknown;
  needs?: Array<{ id: string; data: unknown }>;
  trees?: Record<string, unknown>;
  memberships?: Array<{ id: string; data: unknown }>;
  profiles?: Profiles;
  failRaw?: boolean;
}

function setup(s: Setup) {
  const caller = CALLERS[s.caller ?? "member"];
  const profiles: Profiles = s.profiles ?? {};
  const before = structuredClone(profiles);
  const rawCalls: string[][] = [];
  const readRaw = vi.fn(async (uids: readonly string[]) => {
    rawCalls.push([...uids]);
    if (s.failRaw) throw new Error("uid u-a level 4");
    return uids.map((uid) => profiles[uid]);
  });
  const readLevelsSpy = vi.fn<ReadSkillLevels>((uids, treeIds) => readSkillLevelsBatch(uids, treeIds, { readRaw }));
  const reader: SkillNeedsReader = {
    async listByTeam(_t, limit) {
      return (s.needs ?? []).slice(0, limit);
    },
  };
  const catalogReader: SkillNeedCatalogReader = {
    async listOrderedByCreatedAt() {
      throw new Error("catalog list must not be used");
    },
    async getSkillTree(treeId) {
      return s.trees?.[treeId];
    },
  };
  const listMembershipsForCoverage = vi.fn(async (_t: string, limit: number) => (s.memberships ?? []).slice(0, limit));
  const call = () =>
    createGetTeamSkillCoverage({
      readLevels: readLevelsSpy,
      verifyToken: vi.fn(async () => ({ uid: caller.uid, email: caller.email, email_verified: true }) as never),
      reads: {
        async getTeamStatus() {
          return "teamStatus" in s ? s.teamStatus : "active";
        },
        async getMembership(uid: string, teamId: string) {
          const entry = Object.values(CALLERS).find((c) => c.uid === uid);
          return entry?.role ? { uid, teamId, role: entry.role } : undefined;
        },
      },
      needsStore: getDefaultSkillNeedsStore(reader),
      catalogReader,
      contributionStore: { listMembershipsForCoverage } as unknown as SkillContributionStore,
    })("token", TEAM);
  return { call, rawCalls, readRaw, readLevelsSpy, profiles, before };
}

const uidsOf = (letters: string[]) => letters.map((l) => `u-${l}`);
const five = uidsOf(["a", "b", "c", "d", "e"]);
const base = (levelsPerUid: Array<number | null>, over: Setup = {}): Setup => {
  const profiles: Profiles = {};
  five.forEach((uid, i) => {
    const level = levelsPerUid[i];
    if (level !== undefined && level !== null) profiles[uid] = { levels: { t1: level } };
  });
  return { needs: [need("t1")], trees: { t1: tree("Alpha") }, memberships: five.map((u) => membership(u)), profiles, ...over };
};
const rowsOf = (r: GetTeamSkillCoverageResult) => {
  if (!r.ok) throw new Error("expected ok");
  return r.rows;
};

describe("production wiring", () => {
  it("exports a bound operation and binds only the approved adapter (source)", () => {
    expect(typeof getTeamSkillCoverage).toBe("function");
    const src = readFileSync("src/features/team-skills/server/get-team-skill-coverage.ts", "utf8");
    expect(src).toMatch(/readLevels: readSkillLevelsBatch\b/);
    // Built from parts so this file never names the raw reader (the C1 guard scans identifiers).
    expect(src).not.toContain(["readSkill", "Profiles", "Batch"].join(""));
    expect(src).not.toContain("skill-profile-store");
    expect(src).not.toMatch(/export\s*(\*|\{[^}]*\})\s*from/);
  });
});

describe("eligible uids reach the real adapter's raw boundary", () => {
  it("only genuine, currently consenting members of this team are read, once, deduplicated", async () => {
    const dup = membership("u-dup");
    const s = setup(
      base([3, 3, 3, 3, 3], {
        memberships: [
          ...five.map((u) => membership(u)),
          dup,
          dup,
          membership("u-stale", consent(SKILL_CONTRIBUTION_NOTICE_VERSION + 1)),
          membership("u-old", consent(0)),
          membership("u-none", { skillContribution: undefined }),
          membership("u-bad", { skillContribution: { noticeVersion: 1, consentedAt: "x" } }),
          membership("u-foreign", {}, "team-2"),
          { id: "wrong-id", data: { uid: "u-wrongid", teamId: TEAM, ...consent() } },
          { id: "x", data: null },
        ],
      }),
    );
    await s.call();
    expect(s.rawCalls).toHaveLength(1);
    expect([...s.rawCalls[0]!].sort()).toEqual([...five, "u-dup"].sort());
  });

  it("requests only valid needed tree ids", async () => {
    const s = setup(
      base([3, 3, 3, 3, 3], {
        needs: [need("t1"), need("t2")],
        trees: { t1: tree("Alpha"), t2: { name: "" } },
      }),
    );
    const result = await s.call();
    expect(s.readLevelsSpy.mock.calls.map(([, trees]) => [...trees])).toEqual([["t1"]]);
    expect(rowsOf(result).map((r) => [r.treeId, r.state])).toEqual([
      ["t1", "covered"],
      ["t2", "area_unavailable"],
    ]);
  });

  it("no raw read happens when nobody is eligible", async () => {
    const s = setup(base([3, 3, 3, 3, 3], { memberships: [membership("u-x", { skillContribution: undefined })] }));
    expect(rowsOf(await s.call()).map((r) => r.state)).toEqual(["insufficient_data"]);
    expect(s.readRaw).not.toHaveBeenCalled();
  });
});

describe("authorization over the real reader", () => {
  it.each(["member", "lead", "memberAdmin", "leadAdmin"] as const)("%s is served the same DTO", async (caller) => {
    const result = await setup(base([4, 4, 4, 4, 4], { caller })).call();
    expect(rowsOf(result).map((r) => r.state)).toEqual(["covered"]);
  });

  it("a non-member app-admin is forbidden and nothing is read", async () => {
    const s = setup(base([4, 4, 4, 4, 4], { caller: "nonMemberAdmin" }));
    expect(await s.call()).toEqual({ ok: false, error: "forbidden" });
    expect(s.readRaw).not.toHaveBeenCalled();
  });

  it("a disabled team exposes nothing", async () => {
    const s = setup(base([4, 4, 4, 4, 4], { teamStatus: "disabled" }));
    expect(await s.call()).toEqual({ ok: false, error: "team_disabled" });
    expect(s.readRaw).not.toHaveBeenCalled();
  });
});

describe("k = 5 per skill over real profile reading", () => {
  it(`fewer than ${SKILL_COVERAGE_MIN_CONTRIBUTORS} valid contributors ⇒ insufficient_data; 5 and 6 ⇒ categorical`, async () => {
    expect(rowsOf(await setup(base([4, 4, 4, 4, null])).call())[0]?.state).toBe("insufficient_data");
    expect(rowsOf(await setup(base([4, 4, 4, 4, 4])).call())[0]?.state).toBe("covered");
    const six = [...five, "u-f"];
    const s6 = base([4, 4, 1, 1, 1], {
      memberships: six.map((u) => membership(u)),
      profiles: { ...base([4, 4, 1, 1, 1]).profiles, "u-f": { levels: { t1: 1 } } },
    });
    expect(rowsOf(await setup(s6).call())[0]?.state).toBe("covered");
  });

  it("requiredCoverage above a cohort of 5 is gap", async () => {
    const result = await setup(base([4, 4, 4, 4, 4], { needs: [need("t1", 2, 20)] })).call();
    expect(rowsOf(result)[0]?.state).toBe("gap");
  });

  it("is independent per tree", async () => {
    const profiles: Profiles = {};
    five.forEach((u, i) => (profiles[u] = { levels: i < 4 ? { t1: 4, t2: 4 } : { t1: 4 } }));
    const result = await setup({
      needs: [need("t1"), need("t2")],
      trees: { t1: tree("Alpha"), t2: tree("Beta") },
      memberships: five.map((u) => membership(u)),
      profiles,
    }).call();
    expect(rowsOf(result).map((r) => [r.treeId, r.state])).toEqual([
      ["t1", "covered"],
      ["t2", "insufficient_data"],
    ]);
  });

  it("unassessed, unreadable, invalid, absent and reset profiles are byte-identical to a smaller cohort", async () => {
    const good = { levels: { t1: 4 } };
    const variants: Array<Record<string, unknown> | undefined> = [
      undefined,
      {},
      { levels: null },
      { levels: [4] },
      { levels: 4 },
      { levels: { t1: 9 } },
      { levels: { t1: "4" } },
      { levels: {} }, // profile reset
    ];
    const reference = JSON.stringify(
      await setup({ ...base([4, 4, 4, 4, 4]), profiles: Object.fromEntries(five.slice(0, 4).map((u) => [u, good])) }).call(),
    );
    for (const bad of variants) {
      const profiles: Profiles = Object.fromEntries(five.slice(0, 4).map((u) => [u, good]));
      profiles["u-e"] = bad;
      expect(JSON.stringify(await setup({ ...base([4, 4, 4, 4, 4]), profiles }).call())).toBe(reference);
    }
    expect(JSON.parse(reference).rows[0].state).toBe("insufficient_data");
  });

  it("the response is the same whether 0, 1 or 4 members participate", async () => {
    const responses = new Set<string>();
    for (const n of [0, 1, 4]) {
      const s = base([4, 4, 4, 4, 4], { memberships: five.slice(0, n).map((u) => membership(u)) });
      responses.add(JSON.stringify(await setup(s).call()));
    }
    expect(responses.size).toBe(1);
  });

  it("withdrawal and stale consent flip the state; removal does too", async () => {
    const full = base([4, 4, 4, 4, 4]);
    expect(rowsOf(await setup(full).call())[0]?.state).toBe("covered");
    const withdrawn = { ...full, memberships: full.memberships!.map((m, i) => (i === 0 ? membership("u-a", { skillContribution: undefined }) : m)) };
    expect(rowsOf(await setup(withdrawn).call())[0]?.state).toBe("insufficient_data");
    const stale = { ...full, memberships: full.memberships!.map((m, i) => (i === 0 ? membership("u-a", consent(0)) : m)) };
    expect(rowsOf(await setup(stale).call())[0]?.state).toBe("insufficient_data");
    const removed = { ...full, memberships: full.memberships!.slice(1) };
    expect(rowsOf(await setup(removed).call())[0]?.state).toBe("insufficient_data");
  });

  it("profiles of excluded people never contribute", async () => {
    const s = base([4, 4, 4, 4, null], {
      memberships: [...five.map((u) => membership(u)), membership("u-x", { skillContribution: undefined })],
    });
    s.profiles!["u-x"] = { levels: { t1: 4 } };
    expect(rowsOf(await setup(s).call())[0]?.state).toBe("insufficient_data");
  });

  it("differencing: one boundary participant flips a categorical state (accepted residual)", async () => {
    // Categorical output does not prevent inference over time; it only withholds counts and levels.
    const a = rowsOf(await setup(base([4, 4, 4, 4, null])).call())[0]?.state;
    const b = rowsOf(await setup(base([4, 4, 4, 4, 4])).call())[0]?.state;
    expect([a, b]).toEqual(["insufficient_data", "covered"]);
  });
});

describe("area_unavailable depends only on tree integrity", () => {
  it("is identical across contributor cohorts", async () => {
    const outcomes = new Set<string>();
    for (const levels of [[4, 4, 4, 4, 4], [1, null, null, null, null], [null, null, null, null, null]]) {
      const s = base(levels, { needs: [need("t1"), need("t2")], trees: { t1: tree("Alpha"), t2: { name: 5 } } });
      const rows = rowsOf(await setup(s).call());
      outcomes.add(JSON.stringify(rows.find((r) => r.treeId === "t2")));
    }
    expect(outcomes.size).toBe(1);
    expect([...outcomes][0]).toContain('"state":"area_unavailable"');
  });
});

describe("failures and non-leakage", () => {
  it("a raw read failure is read_failed with no partial rows and no leaked message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await setup(base([4, 4, 4, 4, 4], { failRaw: true })).call();
    expect(result).toEqual({ ok: false, error: "read_failed" });
    expect(JSON.stringify(result)).not.toContain("u-a");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("the serialized response has no identity, consent, count or level field and logs nothing", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    const profiles: Profiles = Object.fromEntries(five.map((u, i) => [u, { levels: { t1: (i % 4) + 1 }, updatedAt: "2030-01-01" }]));
    const result = await setup({ ...base([4, 4, 4, 4, 4]), profiles }).call();
    const rows = rowsOf(result);
    expect(Object.keys(result).sort()).toEqual(["availability", "ok", "rows"]);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["areaName", "requiredCoverage", "requiredLevel", "state", "treeId"]);
    }
    const json = JSON.stringify(result);
    for (const forbidden of ["u-", "ref-", "example.com", "2031", "2030", "consentedAt", "noticeVersion", "levels", "count", "percent"]) {
      expect(json).not.toContain(forbidden);
    }
    // Only the declared policy numbers appear as integers.
    expect(rows.every((r) => [r.requiredLevel, r.requiredCoverage].every(Number.isInteger))).toBe(true);
    for (const spy of logs) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("C1 data is never mutated", () => {
  it("profiles are unchanged and no Firestore collection is touched (mocked admin throws on use)", async () => {
    const s = setup(base([4, 3, 2, 1, 4]));
    await s.call();
    expect(s.profiles).toEqual(s.before);
  });
});
