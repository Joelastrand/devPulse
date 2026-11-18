import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptRecord } from "../../../lib/encryption/record-envelope";
import { isValidTeamSkillAssessment } from "../../team-owned-skills/domain/team-skill-assessment";
import { assessmentLevelContext, openAssessmentDocument } from "../../team-owned-skills/server/assessment-level-codec";
import { toPersistedTeamSkill } from "../../team-owned-skills/server/team-skill-codec";
import { deriveTeamLevel } from "../../team-skills/domain/team-level";
import { SKILL_COVERAGE_MIN_CONTRIBUTORS } from "../../team-skills/domain/skill-coverage-policy";
import {
  readSkillContribution,
  SIMULATED_CONTRIBUTION_FIELD,
  SIMULATED_CONTRIBUTION_TEAM_ID,
  SIMULATED_CONTRIBUTION_UIDS,
  SKILL_CONTRIBUTION_FIELD,
  simulatedContributionPatch,
} from "../../team-skills/domain/skill-contribution";
import { membershipDocId } from "../../teams/domain/team-membership";
import { DEMO_TEAM_SKILLS, teamSkillRecord } from "../team-catalog-fixtures";
import { TEAMKOMPETANSE_AS_OF, TEAMKOMPETANSE_PROFILES } from "./fixtures";
import { buildTeamkompetansePlan } from "./plan";
import {
  resolveLiveCatalog,
  runTeamkompetanseSeed,
  type SeedDatabase,
  type SeedDocument,
  type SeedRef,
  type SeedSnapshot,
  type SeedTransaction,
} from "./live";

const T = SIMULATED_CONTRIBUTION_TEAM_ID;
const REQUIRED = "devpulse-nve";
const CATALOG_AS_OF = new Date("2026-10-01T00:00:00.000Z"); // the catalog's own asOf must be midnight UTC

/** Live catalog ids are generated, not the fixture ids: the seeder must resolve them by name. */
const liveId = (index: number) => `lv${String(index + 1).padStart(2, "0")}`;
const liveIdFor = () => new Map(DEMO_TEAM_SKILLS.map((skill, index) => [skill.skillId, liveId(index)]));

/** In-memory Firestore stand-in: a transaction stages its writes and applies them only when the work resolves. */
function fakeDatabase(initial: Map<string, Record<string, unknown>>) {
  const store = new Map<string, Record<string, unknown>>(initial);
  const snapshot = (path: string): SeedSnapshot => {
    const value = store.get(path);
    return { exists: value !== undefined, data: () => (value === undefined ? undefined : structuredClone(value)) };
  };
  const db: SeedDatabase = {
    doc: (path): SeedRef => ({ path }),
    get: async (ref) => snapshot(ref.path),
    teamSkillsOf: async (teamId): Promise<readonly SeedDocument[]> =>
      [...store.entries()]
        .filter(([path, data]) => path.startsWith("teamSkills/") && data.teamId === teamId)
        .map(([path, data]) => ({ id: path.slice("teamSkills/".length), data: () => structuredClone(data) })),
    async runTransaction<R>(work: (tx: SeedTransaction) => Promise<R>): Promise<R> {
      const staged: Array<() => void> = [];
      const tx: SeedTransaction = {
        get: async (ref) => snapshot(ref.path),
        create: (ref, data) => {
          if (store.has(ref.path)) throw new Error("already exists");
          staged.push(() => store.set(ref.path, structuredClone(data as Record<string, unknown>)));
        },
        update: (ref, data) => {
          if (!store.has(ref.path)) throw new Error("not found");
          staged.push(() => store.set(ref.path, { ...store.get(ref.path), ...(data as Record<string, unknown>) }));
        },
      };
      const result = await work(tx);
      for (const apply of staged) apply();
      return result;
    },
  };
  return { db, store };
}

/** A consistent live world: active team, the 25 catalog skills under generated ids, ten disabled members, nothing seeded yet. */
function freshWorld(): Map<string, Record<string, unknown>> {
  const world = new Map<string, Record<string, unknown>>();
  world.set(`teams/${T}`, { status: "active" });
  DEMO_TEAM_SKILLS.forEach((skill, index) => {
    const record = teamSkillRecord(skill, T, CATALOG_AS_OF, index);
    world.set(`teamSkills/${liveId(index)}`, toPersistedTeamSkill(liveId(index), record) as Record<string, unknown>);
  });
  for (const uid of SIMULATED_CONTRIBUTION_UIDS) {
    world.set(`teamMemberships/${membershipDocId(uid, T)}`, { uid, teamId: T, createdVia: "admin_direct", createdAt: TEAMKOMPETANSE_AS_OF });
  }
  return world;
}

/** Every membership field except the consent field: the write must leave all of these untouched. */
function withoutConsentField(record: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...record };
  delete copy[SKILL_CONTRIBUTION_FIELD];
  return copy;
}

function auth(accounts: Record<string, { disabled: boolean }> = {}) {
  return {
    getUser: async (uid: string) => {
      if (!SIMULATED_CONTRIBUTION_UIDS.includes(uid)) throw new Error("not found");
      return { uid, disabled: (accounts[uid] ?? { disabled: true }).disabled };
    },
  };
}

function run(input: { mode: "preflight" | "write"; db: SeedDatabase; accounts?: Record<string, { disabled: boolean }>; projectId?: string }) {
  return runTeamkompetanseSeed({
    mode: input.mode,
    requiredProjectId: REQUIRED,
    projectId: input.projectId ?? REQUIRED,
    teamId: T,
    db: input.db,
    auth: auth(input.accounts),
  });
}

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("catalog resolution by name", () => {
  it("resolves each fixture skill to exactly one live skill, even though live ids are generated", async () => {
    const { db } = fakeDatabase(freshWorld());
    const resolution = await resolveLiveCatalog({ db, teamId: T });
    expect(resolution.blockers).toEqual([]);
    expect(resolution.liveSkillIdFor.get("skTypescript")).toBe(liveId(0));
    expect(resolution.liveSkillIdFor.size).toBe(DEMO_TEAM_SKILLS.length);
  });

  it("blocks when a fixture skill has no live counterpart, and never guesses", async () => {
    const world = freshWorld();
    world.delete(`teamSkills/${liveId(3)}`);
    const resolution = await resolveLiveCatalog({ db: fakeDatabase(world).db, teamId: T });
    expect(resolution.blockers).toContain("catalog-skill-missing");
  });

  it("blocks when two live skills carry the same fixture name (ambiguous)", async () => {
    const world = freshWorld();
    const duplicate = toPersistedTeamSkill("lvdup", teamSkillRecord(DEMO_TEAM_SKILLS[0], T, CATALOG_AS_OF, 0)) as Record<string, unknown>;
    world.set("teamSkills/lvdup", duplicate);
    const resolution = await resolveLiveCatalog({ db: fakeDatabase(world).db, teamId: T });
    expect(resolution.blockers).toContain("catalog-skill-ambiguous");
  });

  it("blocks on an unreadable catalog document and reports extra unmatched names without blocking", async () => {
    const world = freshWorld();
    world.set("teamSkills/lvbroken", { teamId: T, content: { v: "not-an-envelope" } });
    world.set("teamSkills/lvextra", toPersistedTeamSkill("lvextra", teamSkillRecord({ skillId: "x", name: "Ekstra ferdighet", description: "", category: "Annet" }, T, CATALOG_AS_OF, 99)) as Record<string, unknown>);
    const resolution = await resolveLiveCatalog({ db: fakeDatabase(world).db, teamId: T });
    expect(resolution.blockers).toContain("catalog-skill-unreadable");
    expect(resolution.unmatchedNames).toContain("Ekstra ferdighet");
  });
});

describe("synthetic plan: ownership, catalog, scale and encryption", () => {
  it("references only the ten fictional members, the designated team and resolved live catalog skills", () => {
    const plan = buildTeamkompetansePlan({ teamId: T, liveSkillIdFor: liveIdFor() });
    expect(plan.consents.map((c) => c.uid)).toEqual([...SIMULATED_CONTRIBUTION_UIDS]);
    expect(new Set(plan.assessments.map((a) => a.uid))).toEqual(new Set(SIMULATED_CONTRIBUTION_UIDS));
    const liveIds = new Set(liveIdFor().values());
    expect(plan.assessments.every((a) => liveIds.has(a.skillId))).toBe(true);
    expect(plan.assessments.every((a) => a.data.teamId === T)).toBe(true);
  });

  it("uses only supported levels 1–4 and the production criteria version", () => {
    const plan = buildTeamkompetansePlan({ teamId: T, liveSkillIdFor: liveIdFor() });
    expect(plan.assessments.every((a) => [1, 2, 3, 4].includes(a.level))).toBe(true);
    expect(plan.assessments.every((a) => a.data.criteriaVersion === 1)).toBe(true);
  });

  it("refuses any team other than the designated demo team", () => {
    expect(() => buildTeamkompetansePlan({ teamId: "demo-team", liveSkillIdFor: liveIdFor() })).toThrow("designated demo team");
  });

  it("refuses to plan a fixture skill that has no resolved live id", () => {
    const partial = new Map(liveIdFor());
    partial.delete("skTypescript");
    expect(() => buildTeamkompetansePlan({ teamId: T, liveSkillIdFor: partial })).toThrow("no resolved live catalog skill");
  });

  it("seals every level with the record-specific AAD: the owner's context opens it, another member's does not", () => {
    const plan = buildTeamkompetansePlan({ teamId: T, liveSkillIdFor: liveIdFor() });
    const first = plan.assessments[0];
    const envelope = first.data.level;
    expect(decryptRecord(envelope as never, assessmentLevelContext(first.uid, T, first.skillId))).toBe(JSON.stringify({ level: first.level }));
    expect(() => decryptRecord(envelope as never, assessmentLevelContext("demo-member-99", T, first.skillId))).toThrow();
  });

  it("produces documents the production reader accepts after opening", () => {
    const plan = buildTeamkompetansePlan({ teamId: T, liveSkillIdFor: liveIdFor() });
    const sample = plan.assessments[0];
    const opened = openAssessmentDocument(sample.uid, T, sample.skillId, structuredClone(sample.data));
    expect(isValidTeamSkillAssessment(opened, { uid: sample.uid, skillId: sample.skillId })).toBe(true);
  });

  it("marks every consent as simulated only through the scoped domain patch, which refuses real members", () => {
    const plan = buildTeamkompetansePlan({ teamId: T, liveSkillIdFor: liveIdFor() });
    for (const consent of plan.consents) {
      const patch = simulatedContributionPatch({ uid: consent.uid, teamId: T }, consent.value.consentedAt);
      const written = patch[SKILL_CONTRIBUTION_FIELD];
      expect(written).toEqual({ noticeVersion: 2, consentedAt: consent.value.consentedAt, simulated: true });
      expect(readSkillContribution({ [SKILL_CONTRIBUTION_FIELD]: written }, { uid: consent.uid, teamId: T })?.origin).toBe("simulated");
    }
    expect(() => simulatedContributionPatch({ uid: "someone-real", teamId: T }, TEAMKOMPETANSE_AS_OF)).toThrow("refused");
  });
});

describe("live seeder: preflight, write, skip-identical and conflicts", () => {
  it("preflight on a fresh world is read-only and reports creates with no blockers", async () => {
    const { db, store } = fakeDatabase(freshWorld());
    const before = store.size;
    const report = await run({ mode: "preflight", db });
    expect(report.blockers).toEqual([]);
    expect(report.consent.create).toBe(10);
    expect(report.assessments.create).toBe(report.plannedAssessments);
    expect(report.written).toBeNull();
    expect(report.ok).toBe(true);
    expect(store.size).toBe(before);
  });

  it("write creates exactly the planned assessments and only the consent field, then verifies read-only", async () => {
    const world = freshWorld();
    const { db, store } = fakeDatabase(world);
    const beforeMembership = structuredClone(world.get(`teamMemberships/${membershipDocId("demo-member-01", T)}`) ?? {});
    const report = await run({ mode: "write", db });
    expect(report.ok).toBe(true);
    expect(report.written).toEqual({ consent: 10, assessments: report.plannedAssessments });
    expect(report.verified).toEqual({ consent: 10, assessments: report.plannedAssessments });

    const membership = store.get(`teamMemberships/${membershipDocId("demo-member-01", T)}`) ?? {};
    expect(membership[SKILL_CONTRIBUTION_FIELD]).toEqual({ noticeVersion: 2, consentedAt: expect.any(Date), simulated: true });
    expect(membership[SIMULATED_CONTRIBUTION_FIELD]).toBeUndefined();
    expect(withoutConsentField(membership)).toEqual(withoutConsentField(beforeMembership));
  });

  it("a rerun is idempotent: every record is identical, nothing is written, and the run succeeds", async () => {
    const { db, store } = fakeDatabase(freshWorld());
    await run({ mode: "write", db });
    const snapshotAfterFirst = structuredClone(Object.fromEntries(store));
    const report = await run({ mode: "write", db });
    expect(report.ok).toBe(true);
    expect(report.written).toEqual({ consent: 0, assessments: 0 });
    expect(report.consent.identical).toBe(10);
    expect(Object.fromEntries(store)).toEqual(snapshotAfterFirst);
  });

  it("refuses a membership whose consent differs from the plan (conflict), and writes nothing", async () => {
    const world = freshWorld();
    world.set(`teamMemberships/${membershipDocId("demo-member-02", T)}`, {
      uid: "demo-member-02",
      teamId: T,
      [SKILL_CONTRIBUTION_FIELD]: { noticeVersion: 2, consentedAt: new Date("2020-01-01T00:00:00Z"), simulated: true },
    });
    const { db, store } = fakeDatabase(world);
    const report = await run({ mode: "write", db });
    expect(report.ok).toBe(false);
    expect(report.blockers).toContain("consent-conflict-or-unreadable");
    expect(report.written).toBeNull();
    expect([...store.keys()].some((key) => key.startsWith("teamSkillAssessments/"))).toBe(false);
  });

  it("never overwrites an existing assessment: a different level is a conflict and the document is unchanged", async () => {
    const world = freshWorld();
    const existingPath = `teamSkillAssessments/demo-member-01__${liveId(0)}`;
    world.set(existingPath, { uid: "demo-member-01", teamId: T, skillId: liveId(0), level: { v: "not-ours" }, criteriaVersion: 1, createdAt: TEAMKOMPETANSE_AS_OF, updatedAt: TEAMKOMPETANSE_AS_OF });
    const { db, store } = fakeDatabase(world);
    const before = structuredClone(store.get(existingPath));
    const report = await run({ mode: "write", db });
    expect(report.ok).toBe(false);
    expect(report.blockers).toContain("assessment-conflict-or-unreadable");
    expect(store.get(existingPath)).toEqual(before);
  });

  it("refuses when a fictional account is enabled, and never writes", async () => {
    const { db, store } = fakeDatabase(freshWorld());
    const before = store.size;
    const report = await run({ mode: "write", db, accounts: { "demo-member-05": { disabled: false } } });
    expect(report.blockers).toContain("auth-account-not-disabled");
    expect(report.ok).toBe(false);
    expect(store.size).toBe(before);
  });

  it("refuses a different project before any read or write", async () => {
    const { db, store } = fakeDatabase(freshWorld());
    const before = store.size;
    const report = await run({ mode: "write", db, projectId: "demo-other" });
    expect(report.blockers).toEqual(["project-mismatch"]);
    expect(report.ok).toBe(false);
    expect(store.size).toBe(before);
  });

  it("refuses when the team is inactive", async () => {
    const world = freshWorld();
    world.set(`teams/${T}`, { status: "disabled" });
    const report = await run({ mode: "preflight", db: fakeDatabase(world).db });
    expect(report.blockers).toContain("team-inactive");
    expect(report.ok).toBe(false);
  });

  it("re-checks inside the transaction, so a membership changed after preflight blocks the write", async () => {
    const { db, store } = fakeDatabase(freshWorld());
    const racing: SeedDatabase = {
      ...db,
      runTransaction: <R>(work: (tx: SeedTransaction) => Promise<R>) => {
        // Another writer lands a different consent between the preflight read and this transaction.
        store.set(`teamMemberships/${membershipDocId("demo-member-04", T)}`, {
          uid: "demo-member-04",
          teamId: T,
          [SKILL_CONTRIBUTION_FIELD]: { noticeVersion: 2, consentedAt: new Date("2019-01-01T00:00:00Z"), simulated: true },
        });
        return db.runTransaction(work);
      },
    };
    const report = await run({ mode: "write", db: racing });
    expect(report.ok).toBe(false);
    expect(report.blockers).toContain("consent-conflict-or-unreadable");
    expect([...store.keys()].some((key) => key.startsWith("teamSkillAssessments/"))).toBe(false);
  });
});

describe("aggregation over the synthetic profiles uses the production rule (k >= 3)", () => {
  // Same rule as the team-owned aggregate: fewer than k contributors is suppressed, otherwise the rounded mean.
  function aggregateSkill(skillId: string): { state: "value"; level: number } | { state: "insufficient_data" } {
    const levels = TEAMKOMPETANSE_PROFILES.flatMap((profile) => {
      const level = profile.ratings[skillId];
      return level === undefined ? [] : [level];
    });
    if (levels.length < SKILL_COVERAGE_MIN_CONTRIBUTORS) return { state: "insufficient_data" };
    const derived = deriveTeamLevel(levels, SKILL_COVERAGE_MIN_CONTRIBUTORS);
    return derived.state === "value" ? { state: "value", level: derived.level } : { state: "insufficient_data" };
  }

  it("derives the rounded mean for skills with three or more contributors (hand-checked)", () => {
    expect(aggregateSkill("skTypescript")).toEqual({ state: "value", level: 3 }); // 4,3,3,2 -> 3
    expect(aggregateSkill("skInfosikkerhet")).toEqual({ state: "value", level: 3 }); // 4,2,2,2 -> 3
    expect(aggregateSkill("skInfraKode")).toEqual({ state: "value", level: 2 }); // 3,2,2 -> 2 (mean 2.33)
  });

  it("spreads the visible team levels across the 1-4 scale within the approved ranges", () => {
    const visible = DEMO_TEAM_SKILLS.map((skill) => aggregateSkill(skill.skillId)).flatMap((result) =>
      result.state === "value" ? [result.level] : [],
    );
    const count = (level: number) => visible.filter((value) => value === level).length;
    expect(visible).toHaveLength(23);
    expect(count(4)).toBeGreaterThanOrEqual(3);
    expect(count(4)).toBeLessThanOrEqual(5);
    expect(count(3)).toBeGreaterThanOrEqual(8);
    expect(count(3)).toBeLessThanOrEqual(10);
    expect(count(2)).toBeGreaterThanOrEqual(7);
    expect(count(2)).toBeLessThanOrEqual(9);
  });

  it("suppresses skills with fewer than three contributors, never plotting them as zero", () => {
    expect(aggregateSkill("skTrusselmodellering")).toEqual({ state: "insufficient_data" }); // two raters
    expect(aggregateSkill("skDatakvalitet")).toEqual({ state: "insufficient_data" }); // two raters
  });

  it("contains both covered and under-covered skills, so the demo shows real gaps", () => {
    const states = DEMO_TEAM_SKILLS.map((skill) => aggregateSkill(skill.skillId).state);
    expect(states).toContain("value");
    expect(states).toContain("insufficient_data");
  });
});

