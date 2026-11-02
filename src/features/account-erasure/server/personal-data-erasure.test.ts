import { describe, expect, it } from "vitest";
import { ErasureStepFailure } from "./erasure-runner";
import { runPersonalDataBatch, type PersonalDataErasurePort } from "./personal-data-erasure";

// TASK-022: personal data. Fixtures are synthetic. The erased person is UID; another person is OTHER.
// These are PORT-CONTRACT tests: the in-memory fake stores no document shape, so they prove the step's order, paging,
// idempotency and scoping. Malformed-data removal against the real store is a TASK-038 adapter test.

const UID = "erased-uid";
const OTHER = "other-uid";

type Seed = { skill?: string[]; profiles?: string[]; roleTargets?: Record<string, string[]>; goals?: Record<string, string[]> };

function fakeData(seed: Seed = {}) {
  const skill = new Set(seed.skill ?? []);
  const profiles = new Set(seed.profiles ?? []);
  const roleTargets = new Map<string, Set<string>>(
    Object.entries(seed.roleTargets ?? {}).map(([uid, ids]) => [uid, new Set(ids)]),
  );
  const goals = new Map<string, Set<string>>(Object.entries(seed.goals ?? {}).map(([uid, ids]) => [uid, new Set(ids)]));
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
    async roleTargetIds(uid, limit) {
      return [...(roleTargets.get(uid) ?? [])].slice(0, limit);
    },
    async deleteRoleTarget(uid, roleTargetId) {
      log.push(`roleTarget:${uid}:${roleTargetId}`);
      roleTargets.get(uid)?.delete(roleTargetId);
    },
    async goalIds(uid, limit) {
      return [...(goals.get(uid) ?? [])].slice(0, limit);
    },
    async deleteGoal(uid, goalId) {
      log.push(`goal:${uid}:${goalId}`);
      goals.get(uid)?.delete(goalId);
    },
  };

  return { port, skill, profiles, roleTargets, goals, log };
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
  it("deletes the skill profile, the user profile, every role-target document, and every goal of the erased person", async () => {
    const store = fakeData({
      skill: [UID],
      profiles: [UID],
      roleTargets: { [UID]: ["current", "history-1"] },
      goals: { [UID]: ["goal-1", "goal-2"] },
    });

    await runToDone(store.port, UID);

    expect(store.skill.has(UID)).toBe(false);
    expect(store.profiles.has(UID)).toBe(false);
    expect(store.roleTargets.get(UID)?.size).toBe(0);
    expect(store.goals.get(UID)?.size).toBe(0);
  });

  it("removes every role-target document under the subtree, not only the current one (I-4 is the whole subtree)", async () => {
    const store = fakeData({ roleTargets: { [UID]: ["current", "older-target", "another"] } });

    await runToDone(store.port, UID, 1);

    expect(store.roleTargets.get(UID)?.size).toBe(0);
    expect(store.log.filter((entry) => entry.startsWith("roleTarget:"))).toHaveLength(3);
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

  it("leaves another person's personal data untouched", async () => {
    const store = fakeData({
      skill: [UID, OTHER],
      profiles: [OTHER],
      roleTargets: { [OTHER]: ["current"] },
      goals: { [OTHER]: ["other-goal"] },
    });

    await runToDone(store.port, UID);

    expect(store.skill.has(OTHER)).toBe(true);
    expect(store.profiles.has(OTHER)).toBe(true);
    expect(store.roleTargets.get(OTHER)?.has("current")).toBe(true);
    expect(store.goals.get(OTHER)?.has("other-goal")).toBe(true);
  });

  it("is idempotent: a second run over already-removed data reports done and deletes nothing", async () => {
    const store = fakeData({ skill: [UID], goals: { [UID]: ["goal-1"] } });
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
});
