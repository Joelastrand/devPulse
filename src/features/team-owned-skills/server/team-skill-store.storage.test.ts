import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamSkillAssessmentRecord } from "../domain/team-skill-assessment";
import { getDefaultTeamSkillStore } from "./team-skill-store";

/**
 * Storage boundary of the private rating store. The Firestore double records the exact payload the transaction writes
 * and serves stored documents back, so the test proves what is persisted and that reads open it.
 */
const holder = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), sets: [] as Array<{ path: string; data: Record<string, unknown> }> }));

vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}`, id }),
    }),
    runTransaction: async <T>(work: (tx: unknown) => Promise<T>) =>
      work({
        async get(ref: { path: string }) {
          const data = holder.docs.get(ref.path);
          return { exists: data !== undefined, data: () => data };
        },
        set(ref: { path: string }, data: Record<string, unknown>) {
          holder.sets.push({ path: ref.path, data });
          holder.docs.set(ref.path, data);
        },
      }),
  }),
}));

const record: TeamSkillAssessmentRecord = {
  uid: "uid-1",
  teamId: "team-1",
  skillId: "skill-1",
  level: 3,
  criteriaVersion: 2,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

async function withTx<T>(work: (tx: Parameters<Parameters<ReturnType<typeof getDefaultTeamSkillStore>["runTransaction"]>[0]>[0]) => Promise<T>) {
  return getDefaultTeamSkillStore().runTransaction(work);
}

describe("team skill rating storage boundary", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    holder.docs.clear();
    holder.sets.length = 0;
  });

  it("persists the rating level only as an envelope and keeps identifiers plaintext", async () => {
    await withTx(async (tx) => tx.putAssessment(record));

    expect(holder.sets).toHaveLength(1);
    const persisted = holder.sets[0];
    expect(persisted.path).toBe("teamSkillAssessments/uid-1__skill-1");
    expect(persisted.data).toMatchObject({ uid: "uid-1", teamId: "team-1", skillId: "skill-1", criteriaVersion: 2 });
    expect(persisted.data.level).toMatchObject({ keyVersion: "v2", keyId: "k1" });
    expect(JSON.stringify(persisted.data)).not.toMatch(/"level":3/);
  });

  it("reads back the same level for the owner, team and skill", async () => {
    await withTx(async (tx) => tx.putAssessment(record));
    const read = await withTx((tx) => tx.getAssessment("uid-1", "team-1", "skill-1"));
    expect(read).toMatchObject({ level: 3, criteriaVersion: 2 });
  });

  it("returns a level that fails authentication as invalid when the stored team is changed", async () => {
    await withTx(async (tx) => tx.putAssessment(record));
    const stored = holder.docs.get("teamSkillAssessments/uid-1__skill-1");
    holder.docs.set("teamSkillAssessments/uid-1__skill-1", { ...stored, teamId: "team-2" });
    const read = await withTx((tx) => tx.getAssessment("uid-1", "team-2", "skill-1"));
    expect((read as { level: unknown }).level).toBeNull();
  });


  it("persists the agreed team level and note only as envelopes and reads them back for the team", async () => {
    await withTx(async (tx) =>
      tx.putManualAssessment({ teamId: "team-1", skillId: "skill-1", level: 2, note: "Enighet i retro", criteriaVersion: 2, updatedAt: record.updatedAt, updatedBy: "admin-1" }),
    );
    const persisted = holder.sets.at(-1);
    expect(persisted?.path).toBe("teamManualAssessments/team-1__skill-1");
    expect(persisted?.data).toMatchObject({ teamId: "team-1", skillId: "skill-1", criteriaVersion: 2, updatedBy: "admin-1" });
    expect(JSON.stringify(persisted?.data)).not.toMatch(/Enighet|"level":2/);
    const read = await withTx((tx) => tx.getManualAssessment("team-1", "skill-1"));
    expect(read).toMatchObject({ level: 2, note: "Enighet i retro" });
  });

  describe("team skill catalog content", () => {
    const skill = {
      teamId: "team-1",
      name: "Testautomatisering",
      description: "Hemmelig beskrivelse",
      category: "Kvalitet",
      guidance: { "1": "Startnivå" },
      criteriaVersion: 1,
      active: true,
      sortOrder: 10,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      createdBy: "admin-1",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      updatedBy: "admin-1",
    };

    it("persists name, description, category and guidance only inside one envelope", async () => {
      await withTx(async (tx) => tx.putSkill("skill-1", skill));
      const persisted = holder.sets.at(-1)?.data ?? {};
      expect(persisted).toMatchObject({ teamId: "team-1", criteriaVersion: 1, active: true, sortOrder: 10, createdBy: "admin-1" });
      for (const key of ["name", "description", "category", "guidance"]) expect(Object.hasOwn(persisted, key)).toBe(false);
      expect(JSON.stringify(persisted)).not.toMatch(/Testautomatisering|Hemmelig|Kvalitet|Startniv/);
    });

    it("reads the skill back with its content opened", async () => {
      await withTx(async (tx) => tx.putSkill("skill-1", skill));
      const read = await withTx((tx) => tx.getSkill("skill-1"));
      expect(read).toMatchObject({ name: "Testautomatisering", description: "Hemmelig beskrivelse", category: "Kvalitet", guidance: { "1": "Startnivå" } });
    });

    it("refuses content moved to another skill document (substitution)", async () => {
      await withTx(async (tx) => tx.putSkill("skill-1", skill));
      holder.docs.set("teamSkills/skill-2", holder.docs.get("teamSkills/skill-1") ?? {});
      expect(await withTx((tx) => tx.getSkill("skill-2"))).toBeNull();
    });

    it("refuses a plaintext copy of the content (no plaintext fallback)", async () => {
      holder.docs.set("teamSkills/skill-3", { ...skill, createdAt: skill.createdAt, updatedAt: skill.updatedAt });
      expect(await withTx((tx) => tx.getSkill("skill-3"))).toBeNull();
    });
  });
});
