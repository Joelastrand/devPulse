import { describe, expect, it, vi } from "vitest";
import { SKILL_CONTRIBUTION_NOTICE_VERSION, TEAM_SKILL_COHORT_SCAN_MAX } from "../../team-skills/domain/skill-coverage-policy";
import { membershipDocId } from "../../teams/domain/team-membership";
import { createFakeTeamSkillStore } from "./fake-team-skill-store";
import { createGetTeamOwnedSkillAggregate, type GetTeamOwnedSkillAggregateDeps } from "./get-team-owned-skill-aggregate";
import { readTeamSkillRatingsBatch } from "./read-team-skill-ratings-batch";
import { teamSkillAssessmentDocId } from "../domain/team-skill-assessment";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const NOW = new Date("2026-06-01T12:00:00Z");
const T = "team-a";
const OTHER = "team-b";
const MEMBER = "member-1";
const OUTSIDER = "outsider-1";
const SKILL = "skillA1";
const SKILL_INACTIVE = "skillOff";

type Raw = Record<string, unknown>;

function skillDoc(overrides: Raw = {}): Raw {
  return {
    teamId: T,
    name: "Testautomatisering",
    description: "Skriver og vedlikeholder tester",
    category: null,
    guidance: {},
    criteriaVersion: 2,
    active: true,
    sortOrder: 0,
    createdAt: NOW,
    createdBy: MEMBER,
    updatedAt: NOW,
    updatedBy: MEMBER,
    ...overrides,
  };
}

function assessmentDoc(uid: string, skillId: string, overrides: Raw = {}): Raw {
  return { uid, teamId: T, skillId, level: 3, criteriaVersion: 2, createdAt: NOW, updatedAt: NOW, ...overrides };
}

function membershipScanDoc(uid: string, teamId = T, noticeVersion = SKILL_CONTRIBUTION_NOTICE_VERSION): { id: string; data: Raw } {
  return {
    id: membershipDocId(uid, teamId),
    data: { uid, teamId, skillContribution: { noticeVersion, consentedAt: NOW } },
  };
}

function contributors(prefix: string, count: number, level: number, criteriaVersion = 2) {
  const uids = Array.from({ length: count }, (_, i) => `${prefix}${i}`);
  return { uids, assessments: uids.map((uid) => [uid, level, criteriaVersion] as const) };
}

interface Scenario {
  skills?: Record<string, Raw>;
  scan?: Array<{ id: string; data: Raw }>;
  assessments?: Array<readonly [string, string, Raw]>;
  rawFailure?: boolean;
  scanLimit?: number;
}

function setup(scenario: Scenario = {}) {
  const skills = scenario.skills ?? { [SKILL]: skillDoc() };
  const fake = createFakeTeamSkillStore({
    teams: { [T]: { status: "active" }, [OTHER]: { status: "active" } },
    memberships: { [`${MEMBER}__${T}`]: { uid: MEMBER, teamId: T } },
    skills,
  });
  const rawAssessments = new Map<string, Raw>();
  for (const [uid, skillId, doc] of scenario.assessments ?? []) rawAssessments.set(teamSkillAssessmentDocId(uid, skillId), doc);

  const deps: GetTeamOwnedSkillAggregateDeps = {
    verifyToken: vi.fn().mockImplementation(async (token: string) => ({ uid: token, email: `${token}@example.test`, email_verified: true })),
    skillStore: fake.store,
    contributionStore: {
      listMembershipsForCoverage: vi.fn(async (_teamId: string, limit: number) => (scenario.scan ?? []).slice(0, limit)),
    } as never,
    readRatings: (uids, teamId, targets) =>
      readTeamSkillRatingsBatch(uids, teamId, targets, {
        readRaw: async (keys) => {
          if (scenario.rawFailure) throw new Error("boom");
          return keys.map(({ uid, skillId }) => rawAssessments.get(teamSkillAssessmentDocId(uid, skillId)));
        },
      }),
  };
  return { run: createGetTeamOwnedSkillAggregate(deps), deps };
}

describe("team-owned skill aggregate (privacy-thresholded)", () => {
  it("shows a value only when at least five opted-in contributors rated the skill at the current criteria version", async () => {
    const five = contributors("c", 5, 3);
    const { run } = setup({
      scan: five.uids.map((uid) => membershipScanDoc(uid)),
      assessments: five.assessments.map(([uid, level, cv]) => [uid, SKILL, assessmentDoc(uid, SKILL, { level, criteriaVersion: cv })]),
    });

    const result = await run(MEMBER, T);

    expect(result).toEqual({
      ok: true,
      availability: "available",
      rows: [{ skillId: SKILL, name: "Testautomatisering", state: "value", level: 3 }],
    });
  });

  it("returns insufficient_data with two contributors (below threshold three)", async () => {
    const four = contributors("c", 2, 4);
    const { run } = setup({
      scan: four.uids.map((uid) => membershipScanDoc(uid)),
      assessments: four.assessments.map(([uid, level, cv]) => [uid, SKILL, assessmentDoc(uid, SKILL, { level, criteriaVersion: cv })]),
    });

    const result = await run(MEMBER, T);

    expect(result).toMatchObject({ ok: true, rows: [{ skillId: SKILL, state: "insufficient_data" }] });
  });

  it("never counts a member who has not opted in, even with a rating", async () => {
    const yes = contributors("c", 2, 4);
    const no = contributors("n", 5, 1);
    const { run } = setup({
      scan: [...yes.uids.map((uid) => membershipScanDoc(uid)), ...no.uids.map((uid) => membershipScanDoc(uid, T, 0))],
      assessments: [...yes.assessments, ...no.assessments].map(([uid, level, cv]) => [uid, SKILL, assessmentDoc(uid, SKILL, { level, criteriaVersion: cv })]),
    });

    const result = await run(MEMBER, T);

    expect(result).toMatchObject({ ok: true, rows: [{ state: "insufficient_data" }] });
  });

  it("excludes ratings given under an older criteria version rather than mixing them in", async () => {
    const current = contributors("c", 2, 4, 2);
    const stale = contributors("s", 3, 1, 1);
    const { run } = setup({
      scan: [...current.uids, ...stale.uids].map((uid) => membershipScanDoc(uid)),
      assessments: [...current.assessments, ...stale.assessments].map(([uid, level, cv]) => [uid, SKILL, assessmentDoc(uid, SKILL, { level, criteriaVersion: cv })]),
    });

    const result = await run(MEMBER, T);

    expect(result).toMatchObject({ ok: true, rows: [{ state: "insufficient_data" }] });
  });

  it("suppresses a skill when any eligible contributor's stored rating is invalid (fail closed)", async () => {
    const five = contributors("c", 5, 2);
    const { run } = setup({
      scan: five.uids.map((uid) => membershipScanDoc(uid)),
      assessments: [
        ...five.assessments.slice(0, 4).map(([uid, level, cv]) => [uid, SKILL, assessmentDoc(uid, SKILL, { level, criteriaVersion: cv })] as const),
        [five.uids[4], SKILL, assessmentDoc(five.uids[4], SKILL, { level: 9 })] as const,
      ],
    });

    const result = await run(MEMBER, T);

    expect(result).toMatchObject({ ok: true, rows: [{ state: "insufficient_data" }] });
  });

  it("does not count another team's rating for the same person (cross-team isolation)", async () => {
    const five = contributors("c", 5, 2);
    const { run } = setup({
      scan: five.uids.map((uid) => membershipScanDoc(uid)),
      assessments: five.assessments.map(([uid, level, cv]) => [uid, SKILL, assessmentDoc(uid, SKILL, { level, criteriaVersion: cv, teamId: OTHER })]),
    });

    const result = await run(MEMBER, T);

    expect(result).toMatchObject({ ok: true, rows: [{ state: "insufficient_data" }] });
  });

  it("omits inactive skills entirely", async () => {
    const { run } = setup({ skills: { [SKILL]: skillDoc(), [SKILL_INACTIVE]: skillDoc({ active: false, sortOrder: 1 }) } });

    const result = await run(MEMBER, T);

    expect(result).toMatchObject({ ok: true, availability: "available", rows: [{ skillId: SKILL }] });
    expect(JSON.stringify(result)).not.toContain(SKILL_INACTIVE);
  });

  it("returns no uid, per-person value or contributor count", async () => {
    const five = contributors("c", 5, 4);
    const { run } = setup({
      scan: five.uids.map((uid) => membershipScanDoc(uid)),
      assessments: five.assessments.map(([uid, level, cv]) => [uid, SKILL, assessmentDoc(uid, SKILL, { level, criteriaVersion: cv })]),
    });

    const serialized = JSON.stringify(await run(MEMBER, T));

    for (const uid of five.uids) expect(serialized).not.toContain(uid);
    expect(serialized).not.toContain("count");
    expect(serialized).not.toContain("contributors");
  });

  it("refuses a caller who is not a genuine member of the team", async () => {
    const { run } = setup();

    expect(await run(OUTSIDER, T)).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses an unverifiable token", async () => {
    const { deps } = setup();
    const run = createGetTeamOwnedSkillAggregate({ ...deps, verifyToken: vi.fn().mockRejectedValue(new Error("bad")) });

    expect(await run("", T)).toMatchObject({ ok: false });
  });

  it("performs no membership scan when the team has no active skills", async () => {
    const { run, deps } = setup({ skills: { [SKILL_INACTIVE]: skillDoc({ active: false }) } });

    expect(await run(MEMBER, T)).toEqual({ ok: true, availability: "available", rows: [] });
    expect(deps.contributionStore?.listMembershipsForCoverage).not.toHaveBeenCalled();
  });

  it("returns incomplete without deriving anything when the membership scan exceeds its bound", async () => {
    const many = Array.from({ length: TEAM_SKILL_COHORT_SCAN_MAX + 1 }, (_, i) => membershipScanDoc(`u${i}`));
    const { run, deps } = setup({ scan: many });

    expect(await run(MEMBER, T)).toEqual({ ok: true, availability: "incomplete", rows: [] });
    expect(deps.contributionStore?.listMembershipsForCoverage).toHaveBeenCalledWith(T, TEAM_SKILL_COHORT_SCAN_MAX + 1);
  });

  it("fails with read_failed, never a partial result, when rating reads fail", async () => {
    const five = contributors("c", 5, 3);
    const { run } = setup({
      scan: five.uids.map((uid) => membershipScanDoc(uid)),
      rawFailure: true,
    });

    expect(await run(MEMBER, T)).toEqual({ ok: false, error: "read_failed" });
  });
});
