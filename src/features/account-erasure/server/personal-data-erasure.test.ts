import { describe, expect, it } from "vitest";
import { ErasureStepFailure } from "./erasure-runner";
import { runPersonalDataBatch, type PersonalDataErasurePort } from "./personal-data-erasure";

// TASK-022: personal data. Fixtures are synthetic. The erased person is UID; another person is OTHER.
// These are PORT-CONTRACT tests: the in-memory fake stores no document shape, so they prove the step's order, paging,
// idempotency and scoping. Malformed-data removal against the real store is a TASK-038 adapter test.

const UID = "erased-uid";
const OTHER = "other-uid";

type Seed = {
  skill?: string[];
  profiles?: string[];
  /** uids that hold a formal role assignment (`roleAssignments/{uid}`). */
  roleAssignments?: string[];
  goals?: Record<string, string[]>;
  responsibilities?: Record<string, string[]>;
  achievements?: Record<string, string[]>;
  teamAssessments?: Record<string, string[]>;
};

function fakeData(seed: Seed = {}) {
  const skill = new Set(seed.skill ?? []);
  const profiles = new Set(seed.profiles ?? []);
  const roleAssignments = new Set(seed.roleAssignments ?? []);
  const goals = new Map<string, Set<string>>(Object.entries(seed.goals ?? {}).map(([uid, ids]) => [uid, new Set(ids)]));
  const responsibilities = new Map<string, Set<string>>(
    Object.entries(seed.responsibilities ?? {}).map(([uid, ids]) => [uid, new Set(ids)]),
  );
  const achievements = new Map<string, Set<string>>(Object.entries(seed.achievements ?? {}).map(([uid, ids]) => [uid, new Set(ids)]));
  const teamAssessments = new Map<string, Set<string>>(Object.entries(seed.teamAssessments ?? {}).map(([uid, ids]) => [uid, new Set(ids)]));
  const log: string[] = [];

  const port: PersonalDataErasurePort = {
    async skillProfileExists(uid) {
      return skill.has(uid);
    },
    async deleteSkillProfile(uid) {
      log.push(`skill:${uid}`);
      skill.delete(uid);
    },
    async userProfileExists(uid) {
      return profiles.has(uid);
    },
    async deleteUserProfile(uid) {
      log.push(`profile:${uid}`);
      profiles.delete(uid);
    },
    async roleAssignmentExists(uid) {
      return roleAssignments.has(uid);
    },
    async deleteRoleAssignment(uid) {
      log.push(`roleAssignment:${uid}`);
      roleAssignments.delete(uid);
    },
    async goalIds(uid, limit) {
      return [...(goals.get(uid) ?? [])].slice(0, limit);
    },
    async deleteGoal(uid, goalId) {
      log.push(`goal:${uid}:${goalId}`);
      goals.get(uid)?.delete(goalId);
    },
    async responsibilityIds(uid, limit) {
      return [...(responsibilities.get(uid) ?? [])].slice(0, limit);
    },
    async deleteResponsibility(uid, responsibilityId) {
      log.push(`responsibility:${uid}:${responsibilityId}`);
      responsibilities.get(uid)?.delete(responsibilityId);
    },
    async achievementIds(uid, limit) {
      return [...(achievements.get(uid) ?? [])].slice(0, limit);
    },
    async deleteAchievement(uid, achievementId) {
      log.push(`achievement:${uid}:${achievementId}`);
      achievements.get(uid)?.delete(achievementId);
    },
    async teamSkillAssessmentIds(uid, limit) {
      return [...(teamAssessments.get(uid) ?? [])].slice(0, limit);
    },
    async deleteTeamSkillAssessment(uid, assessmentId) {
      log.push(`teamAssessment:${uid}:${assessmentId}`);
      teamAssessments.get(uid)?.delete(assessmentId);
    },
  };

  return { port, skill, profiles, roleAssignments, goals, responsibilities, achievements, teamAssessments, log };
}

async function runToDone(port: PersonalDataErasurePort, uid: string, maxWrites = 100): Promise<number> {
  let batches = 0;
  for (;;) {
    batches += 1;
    if (batches > 100) throw new Error("personal data step did not reach done");
    if ((await runPersonalDataBatch({ port }, uid, maxWrites)) === "done") return batches;
  }
}

describe("personal data erasure step (TASK-022)", () => {
  it("deletes the skill profile, the user profile, the role assignment, and every goal of the erased person", async () => {
    const store = fakeData({
      skill: [UID],
      profiles: [UID],
      roleAssignments: [UID],
      goals: { [UID]: ["goal-1", "goal-2"] },
    });

    await runToDone(store.port, UID);

    expect(store.skill.has(UID)).toBe(false);
    expect(store.profiles.has(UID)).toBe(false);
    expect(store.roleAssignments.has(UID)).toBe(false);
    expect(store.goals.get(UID)?.size).toBe(0);
  });

  it("removes the formal role assignment (I-4) and records exactly one delete for it", async () => {
    const store = fakeData({ roleAssignments: [UID] });

    await runToDone(store.port, UID);

    expect(store.roleAssignments.has(UID)).toBe(false);
    expect(store.log.filter((entry) => entry.startsWith("roleAssignment:"))).toEqual([`roleAssignment:${UID}`]);
  });

  it("pages across more than one goal page, removing every goal", async () => {
    const goalIds = Array.from({ length: 5 }, (_, index) => `goal-${index + 1}`);
    const store = fakeData({ goals: { [UID]: goalIds } });

    const batches = await runToDone(store.port, UID, 2);

    expect(store.goals.get(UID)?.size).toBe(0);
    expect(batches).toBeGreaterThan(2);
    expect(store.log.filter((entry) => entry.startsWith("goal:"))).toHaveLength(5);
  });

  it("removes existence-only skill and profile documents (port contract; the real malformed case is a TASK-038 adapter test)", async () => {
    const store = fakeData({ skill: [UID], profiles: [UID] });

    await runToDone(store.port, UID);

    expect(store.skill.has(UID)).toBe(false);
    expect(store.profiles.has(UID)).toBe(false);
  });

  it("leaves another person's personal data and role assignment untouched", async () => {
    const store = fakeData({
      skill: [UID, OTHER],
      profiles: [OTHER],
      roleAssignments: [UID, OTHER],
      goals: { [OTHER]: ["other-goal"] },
    });

    await runToDone(store.port, UID);

    expect(store.skill.has(OTHER)).toBe(true);
    expect(store.profiles.has(OTHER)).toBe(true);
    expect(store.roleAssignments.has(OTHER)).toBe(true);
    expect(store.goals.get(OTHER)?.has("other-goal")).toBe(true);
  });

  it("is idempotent: a second run over already-removed data reports done and deletes nothing", async () => {
    const store = fakeData({ skill: [UID], roleAssignments: [UID], goals: { [UID]: ["goal-1"] } });
    await runToDone(store.port, UID);
    const writesAfterFirstRun = store.log.length;

    expect(await runPersonalDataBatch({ port: store.port }, UID, 100)).toBe("done");
    expect(store.log.length).toBe(writesAfterFirstRun);
  });

  it("reports done when the erased person has no personal data", async () => {
    const store = fakeData();
    expect(await runPersonalDataBatch({ port: store.port }, UID, 100)).toBe("done");
  });

  it("refuses a zero write budget as a programming error", async () => {
    const store = fakeData();
    await expect(runPersonalDataBatch({ port: store.port }, UID, 0)).rejects.toBeInstanceOf(ErasureStepFailure);
  });

  it("removes every responsibility and achievement of the erased person (I-17, I-18), paged, and keeps other people's", async () => {
    const store = fakeData({
      responsibilities: { [UID]: ["r1", "r2", "r3"], [OTHER]: ["keep-r"] },
      achievements: { [UID]: ["a1", "a2"], [OTHER]: ["keep-a"] },
    });
    await runToDone(store.port, UID, 2);
    expect(store.responsibilities.get(UID)?.size ?? 0).toBe(0);
    expect(store.achievements.get(UID)?.size ?? 0).toBe(0);
    expect(store.responsibilities.get(OTHER)).toEqual(new Set(["keep-r"]));
    expect(store.achievements.get(OTHER)).toEqual(new Set(["keep-a"]));
  });

  it("removes every team-skill rating of the erased person (I-19), paged, and keeps other people's", async () => {
    const store = fakeData({ teamAssessments: { [UID]: ["u__s1", "u__s2", "u__s3"], [OTHER]: ["keep__s9"] } });

    await runToDone(store.port, UID, 2);

    expect(store.teamAssessments.get(UID)?.size).toBe(0);
    expect(store.teamAssessments.get(OTHER)?.has("keep__s9")).toBe(true);
  });

  it("the personal records step needs no encryption key: it only deletes by path", async () => {
    const store = fakeData({ responsibilities: { [UID]: ["r1"] } });
    const keyBefore = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      await runToDone(store.port, UID);
    } finally {
      if (keyBefore !== undefined) process.env.ENCRYPTION_KEY = keyBefore;
    }
    expect(store.log).toContain(`responsibility:${UID}:r1`);
  });
});
