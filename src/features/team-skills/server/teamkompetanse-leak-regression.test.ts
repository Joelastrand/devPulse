import { describe, expect, it, vi } from "vitest";
import { membershipDocId } from "../../teams/domain/team-membership";
import { SKILL_CONTRIBUTION_FIELD } from "../domain/skill-contribution";
import { SKILL_CONTRIBUTION_NOTICE_VERSION } from "../domain/skill-coverage-policy";
import { deriveCoverageState } from "../domain/skill-coverage";
import { skillNeedDocId, type RequiredLevel, type SkillNeedRecord } from "../domain/skill-need";
import { createGetTeamSkillCoverage, type GetTeamSkillCoverageResult, type ReadSkillLevels } from "./get-team-skill-coverage";
import type { SkillContributionStore } from "./skill-contribution-store";
import type { SkillNeedCatalogReader } from "./skill-need-catalog";
import { getDefaultSkillNeedsStore, type SkillNeedsReader } from "./skill-needs-store";

/**
 * Permanent regression cases for the Teamkompetanse privacy defects A1–A4
 * (docs/features/team-experience-redesign/D1-OPTION-B-PROPOSAL.md §10a).
 *
 * Conventions:
 * - Synthetic data only. Firebase is mocked to throw, so any real read or write fails the test.
 * - `it.fails` marks an EXPECTED-TO-FAIL security case: the assertion describes the required safe behaviour, and
 *   the current implementation violates it, so the test passes today. When remediation is approved and implemented,
 *   the case starts failing; at that point change `it.fails` to `it` and keep the assertion. Do not delete it.
 * - Plain `it` cases are sanity checks that prove the fixtures reach the states the vulnerability cases rely on.
 */

// Any real Firestore/Auth use fails the test.
vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const TEAM = "team-regression";
const WHEN = new Date("2026-02-01T00:00:00Z");
const TREE = "tree-synthetic";
const VIEWER = "u-viewer";

interface Member {
  uid: string;
  level: number | null;
  /** false = the membership has no contribution object (withdrawn, never opted in, or stale). */
  contributing?: boolean;
}

function consent(version: number = SKILL_CONTRIBUTION_NOTICE_VERSION) {
  return { [SKILL_CONTRIBUTION_FIELD]: { noticeVersion: version, consentedAt: new Date("2031-01-01T00:00:00Z") } };
}

function membershipOf(member: Member) {
  const data = {
    uid: member.uid,
    teamId: TEAM,
    role: "member",
    memberRef: `ref-${member.uid}`,
    ...(member.contributing === false ? {} : consent()),
  };
  return { id: membershipDocId(member.uid, TEAM), data: data as unknown };
}

function needOf(requiredLevel: RequiredLevel, requiredCoverage: number) {
  const data: SkillNeedRecord = { teamId: TEAM, treeId: TREE, requiredLevel, requiredCoverage, createdAt: WHEN, updatedAt: WHEN };
  return { id: skillNeedDocId(TEAM, TREE), data: data as unknown };
}

/**
 * Runs the production coverage operation over synthetic members. `members` is the team roster; a member with a
 * level has a valid level for the tree, and a member without contribution is in the roster but not counted.
 */
async function coverageOf(
  members: Member[],
  requiredLevel: RequiredLevel,
  requiredCoverage: number,
): Promise<GetTeamSkillCoverageResult> {
  const profiles: Record<string, { levels: Record<string, number> } | undefined> = {};
  for (const m of members) {
    if (m.level !== null) profiles[m.uid] = { levels: { [TREE]: m.level } };
  }
  // Injected reader with the documented ReadSkillLevels contract: valid levels per tree, sorted, identity-free.
  // It deliberately does not import the production batch adapter (the team-skills scope guard pins that import).
  const readLevels = vi.fn<ReadSkillLevels>(async (uids, treeIds) => {
    const levelsByTree = new Map<string, number[]>(treeIds.map((treeId) => [treeId, []]));
    for (const uid of uids) {
      const level = profiles[uid]?.levels?.[TREE];
      if (typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 4) {
        levelsByTree.get(TREE)?.push(level);
      }
    }
    for (const levels of levelsByTree.values()) levels.sort((a, b) => a - b);
    return { ok: true, levelsByTree };
  });
  const needsReader: SkillNeedsReader = { async listByTeam() { return [needOf(requiredLevel, requiredCoverage)]; } };
  const catalogReader: SkillNeedCatalogReader = {
    async listOrderedByCreatedAt() {
      throw new Error("catalog list must not be used");
    },
    async getSkillTree() {
      return {
        name: "Synthetic area",
        nodes: [
          { nodeId: "node-0", label: "A", order: 0 },
          { nodeId: "node-1", label: "B", order: 1 },
        ],
        createdAt: WHEN,
        createdBy: "admin",
      };
    },
  };
  const memberships = members.map(membershipOf);
  const run = createGetTeamSkillCoverage({
    readLevels,
    verifyToken: vi.fn(async () => ({ uid: VIEWER, email: "viewer@example.com", email_verified: true }) as never),
    reads: {
      async getTeamStatus() {
        return "active";
      },
      async getMembership(uid: string, teamId: string) {
        return uid === VIEWER ? { uid, teamId, role: "member" } : undefined;
      },
    },
    needsStore: getDefaultSkillNeedsStore(needsReader),
    catalogReader,
    contributionStore: {
      listMembershipsForCoverage: vi.fn(async (_t: string, limit: number) => memberships.slice(0, limit)),
    } as unknown as SkillContributionStore,
  });
  return run("token", TEAM);
}

/** The published state for the single synthetic need. */
async function stateOf(members: Member[], requiredLevel: RequiredLevel, requiredCoverage: number) {
  const result = await coverageOf(members, requiredLevel, requiredCoverage);
  if (!result.ok || result.availability !== "available") throw new Error("expected an available coverage response");
  return result.rows[0]?.state;
}

const uid = (letter: string) => `u-${letter}`;
const roster = (levels: Array<number | null>): Member[] =>
  levels.map((level, i) => ({ uid: uid(String.fromCharCode(97 + i)), level }));

describe("fixture sanity (these must pass; they prove the vulnerability cases below are meaningful)", () => {
  it("five consenting members at level 4 reach the evaluated state covered", async () => {
    expect(await stateOf(roster([4, 4, 4, 4, 4]), 4, 1)).toBe("covered");
  });

  it("four contributors are suppressed as insufficient_data", async () => {
    expect(await stateOf(roster([4, 4, 4, 4]), 4, 1)).toBe("insufficient_data");
  });

  it("the pure derivation is the one the operation uses (k = 5 on the contributor count)", () => {
    expect(deriveCoverageState({ requiredLevel: 4, requiredCoverage: 1, levels: [4, 4, 4, 4] })).toBe("insufficient_data");
    expect(deriveCoverageState({ requiredLevel: 4, requiredCoverage: 1, levels: [4, 4, 4, 4, 4] })).toBe("covered");
  });
});

describe("KNOWN VULNERABILITY A1: self-toggle reveals the exact contributor threshold (expected-to-fail)", () => {
  // Synthetic: five contributors, one of them (u-a, level 4) withdraws. Safe behaviour: a single member's withdrawal
  // must not flip the published state between an evaluated state and insufficient_data.
  it.fails("a single contributor's withdrawal from a cohort of exactly five does not change the published state", async () => {
    const withAll = roster([4, 4, 4, 4, 4]);
    const withoutA = withAll.map((m) => (m.uid === uid("a") ? { ...m, contributing: false } : m));
    expect(await stateOf(withoutA, 4, 1)).toBe(await stateOf(withAll, 4, 1));
  });
});

describe("KNOWN VULNERABILITY A2: threshold sweeps reveal the private rating distribution (expected-to-fail)", () => {
  // Synthetic cohort of five with levels 1, 2, 4, 4, 3. A team admin sweeps requiredCoverage for each requiredLevel
  // and reads the state flip points. Safe behaviour: the sweep must not reconstruct the exact distribution.
  const COHORT = [1, 2, 4, 4, 3];
  const TRUE_AT_OR_ABOVE: Record<2 | 3 | 4, number> = { 2: 4, 3: 3, 4: 2 };

  async function sweepCountAtOrAbove(level: RequiredLevel, members: Member[]): Promise<number> {
    let highest = 0;
    for (let r = 1; r <= 5; r++) {
      if ((await stateOf(members, level, r)) === "covered") highest = r;
    }
    return highest;
  }

  it.fails("a threshold sweep over requiredCoverage does not recover the exact count at or above each level", async () => {
    const members = roster(COHORT);
    const recovered: Record<2 | 3 | 4, number> = { 2: 0, 3: 0, 4: 0 };
    for (const level of [2, 3, 4] as const) recovered[level] = await sweepCountAtOrAbove(level, members);
    expect(recovered).not.toEqual(TRUE_AT_OR_ABOVE);
  });
});

describe("KNOWN VULNERABILITY A3: a five-member team exposes whole-team coverage (expected-to-fail)", () => {
  // Synthetic team of five; every member contributes and has assessed the tree. The cohort is the whole roster, so
  // any evaluated state describes every member. Safe behaviour: no evaluated state for a roster this small.
  it.fails("a five-member team where all members contribute is not published as covered or gap", async () => {
    const state = await stateOf(roster([4, 4, 4, 4, 4]), 4, 1);
    expect(state).toBe("insufficient_data");
  });
});

describe("KNOWN VULNERABILITY A4: one join or opt-in changes the published state immediately (expected-to-fail)", () => {
  // Synthetic: four contributors, then a fifth member (u-e, level 4) opts in. Safe behaviour: a single opt-in does not
  // change the published state on the very next read (stable publication).
  it.fails("a single opt-in that completes a cohort of five does not change the state on the next read", async () => {
    const beforeOptIn = roster([4, 4, 4, 4, 4]).map((m) => (m.uid === uid("e") ? { ...m, contributing: false } : m));
    const before = await stateOf(beforeOptIn, 4, 1);
    const afterOptIn = roster([4, 4, 4, 4, 4]);
    const after = await stateOf(afterOptIn, 4, 1);
    expect(after).toBe(before);
  });
});
