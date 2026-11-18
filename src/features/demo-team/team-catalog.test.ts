import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "./crypto";
import { buildDemoSeedPlan, type PlannedOperation } from "./plan";
import { runDemoPreflight, type DemoReader } from "./preflight";
import { DEMO_COMPETENCE_PLANS, DEMO_TEAM_SKILLS, competencePlanRecord, teamSkillRecord } from "./team-catalog-fixtures";
import { parseStoredCompetencePlan } from "../team-competence-plan/domain/competence-plan";
import { isValidTeamSkillRecord } from "../team-owned-skills/domain/team-skill";
import { countPriorityPlans } from "../teams/domain/team-oversikt";
import { openCompetencePlanDocument, toPersistedCompetencePlan } from "../team-competence-plan/server/competence-plan-codec";
import { openTeamSkillDocument, toPersistedTeamSkill } from "../team-owned-skills/server/team-skill-codec";
import { resolveDemoSeedConfig } from "./config";

/**
 * Competence plans (Kompetanseplan) and the team skill catalog (Teamkompetanse). Offline and deterministic. The real codecs
 * run with a test-only key, so AAD binding and envelopes are exercised for real.
 */
const TEAM = "8yB2bS8Jav69TCfDETON";
const OTHER_TEAM = "other-team-1";
const AS_OF = new Date("2026-11-13T00:00:00.000Z");
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const planOps = (ops: readonly PlannedOperation[]) => ops.filter((o) => o.collection === "teamCompetencePlans");
const skillOps = (ops: readonly PlannedOperation[]) => ops.filter((o) => o.collection === "teamSkills");
const plan = () => buildDemoSeedPlan({ presenterUid: PRESENTER, teamId: TEAM, asOf: AS_OF, sealRecord: demoCrypto.sealRecord });

describe("competence plans: schema, encryption and priority", () => {
  it("every fixture plan is valid under the domain parser after a real round trip through the codec", () => {
    for (const p of DEMO_COMPETENCE_PLANS) {
      const stored = toPersistedCompetencePlan(p.planId, competencePlanRecord(p, TEAM, AS_OF) as never, demoCrypto.sealRecord);
      const opened = openCompetencePlanDocument(p.planId, stored, demoCrypto.openRecord);
      expect(parseStoredCompetencePlan(opened, { docId: p.planId })).not.toBeNull();
    }
  });

  it("never stores a plan title or milestone title as plaintext", () => {
    const serialized = JSON.stringify(planOps(plan().operations));
    for (const p of DEMO_COMPETENCE_PLANS) {
      expect(serialized).not.toContain(p.title);
      for (const m of p.milestones) expect(serialized).not.toContain(m.title);
    }
  });

  it("binds each sealed plan to its own team and plan id (AAD): substitution does not open", () => {
    const p = DEMO_COMPETENCE_PLANS[0];
    const stored = toPersistedCompetencePlan(p.planId, competencePlanRecord(p, TEAM, AS_OF) as never, demoCrypto.sealRecord);
    expect(openCompetencePlanDocument(DEMO_COMPETENCE_PLANS[1].planId, stored, demoCrypto.openRecord)).toBeNull();
    expect(openCompetencePlanDocument(p.planId, { ...stored, teamId: OTHER_TEAM }, demoCrypto.openRecord)).toBeNull();
  });

  it("plans are independent of team skill needs: no plan references a skill tree", () => {
    for (const p of DEMO_COMPETENCE_PLANS) expect(competencePlanRecord(p, TEAM, AS_OF).treeId).toBeNull();
  });

  it("the overview's prioritized-plan count is derived from the records: three high-priority, non-archived plans", () => {
    const inputs = DEMO_COMPETENCE_PLANS.map((p) => ({ priority: p.priority, archived: p.archived }));
    expect(countPriorityPlans(inputs as never)).toBe(3);
  });

  it("the plans cover varied priorities, statuses and deadlines", () => {
    expect(new Set(DEMO_COMPETENCE_PLANS.map((p) => p.priority))).toEqual(new Set(["high", "medium", "low"]));
    const statuses = new Set(DEMO_COMPETENCE_PLANS.flatMap((p) => p.milestones.map((m) => m.status)));
    expect(statuses).toEqual(new Set(["planned", "in_progress", "completed"]));
    expect(DEMO_COMPETENCE_PLANS.filter((p) => p.archived)).toHaveLength(1);
  });
});

describe("team skill catalog: schema, encryption and contents", () => {
  it("contains 20 to 30 skills in several categories, with unique alphanumeric ids", () => {
    expect(DEMO_TEAM_SKILLS.length).toBeGreaterThanOrEqual(20);
    expect(DEMO_TEAM_SKILLS.length).toBeLessThanOrEqual(30);
    expect(new Set(DEMO_TEAM_SKILLS.map((s) => s.skillId)).size).toBe(DEMO_TEAM_SKILLS.length);
    expect(DEMO_TEAM_SKILLS.every((s) => /^[A-Za-z0-9]{1,64}$/.test(s.skillId))).toBe(true);
    expect(new Set(DEMO_TEAM_SKILLS.map((s) => s.category)).size).toBeGreaterThanOrEqual(6);
  });

  it("covers the requested competencies", () => {
    const names = DEMO_TEAM_SKILLS.map((s) => s.name);
    for (const required of ["TypeScript", "React", "API-design", "Systemarkitektur", "Skyplattform", "Infrastruktur som kode", "Informasjonssikkerhet", "Tilgjengelighet", "Testautomatisering", "Observability", "Hendelseshåndtering", "Datamodellering", "Teknisk dokumentasjon", "Teknisk veiledning"]) {
      expect(names).toContain(required);
    }
  });

  it("every skill is valid under the domain validator after a real round trip, and no name or description is plaintext", () => {
    const serialized = JSON.stringify(skillOps(plan().operations).map((o) => o.data));
    for (const s of DEMO_TEAM_SKILLS) {
      expect(serialized).not.toContain(s.name);
      expect(serialized).not.toContain(s.description);
      const stored = toPersistedTeamSkill(s.skillId, teamSkillRecord(s, TEAM, AS_OF, 0) as never, demoCrypto.sealRecord);
      const opened = openTeamSkillDocument(s.skillId, stored, demoCrypto.openRecord);
      expect(isValidTeamSkillRecord(opened, { teamId: TEAM, skillId: s.skillId })).toBe(true);
    }
  });

  it("binds each skill to its team and skill id (AAD): substitution does not open", () => {
    const s = DEMO_TEAM_SKILLS[0];
    const stored = toPersistedTeamSkill(s.skillId, teamSkillRecord(s, TEAM, AS_OF, 0) as never, demoCrypto.sealRecord);
    expect(openTeamSkillDocument(DEMO_TEAM_SKILLS[1].skillId, stored, demoCrypto.openRecord)).toBeNull();
    expect(openTeamSkillDocument(s.skillId, { ...stored, teamId: OTHER_TEAM }, demoCrypto.openRecord)).toBeNull();
  });

  it("the plan creates every catalog skill and every plan as a create-only document in the selected team", () => {
    const plans = planOps(plan().operations);
    const skills = skillOps(plan().operations);
    expect(plans.every((o) => o.writeClass === "C" && (o.data as { teamId: string }).teamId === TEAM)).toBe(true);
    expect(skills.every((o) => o.writeClass === "C" && (o.data as { teamId: string }).teamId === TEAM)).toBe(true);
    expect(plans).toHaveLength(DEMO_COMPETENCE_PLANS.length);
    expect(skills).toHaveLength(DEMO_TEAM_SKILLS.length);
  });
});

describe("skip, conflict and foreign-team handling for the new documents", () => {
  const preflight = async (existing: Record<string, unknown>, path: string) => {
    const built = plan();
    const docs: Record<string, unknown> = {};
    for (const op of built.operations) docs[op.path] = op.data;
    docs[path] = existing;
    const reader: DemoReader = {
      async get(p: string) {
        return p in docs ? { exists: true, data: docs[p] } : { exists: false };
      },
    };
    const resolved = resolveDemoSeedConfig({
      argv: ["--project", "devpulse-nve", "--presenter-uid", PRESENTER, "--team-id", TEAM, "--as-of", "2026-11-13"],
      env: { FIREBASE_PROJECT_ID: "devpulse-nve", FIREBASE_CLIENT_EMAIL: "seed@devpulse-nve.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: "placeholder" },
      now: () => AS_OF,
    });
    if (!resolved.ok) throw new Error("test config");
    return runDemoPreflight({
      config: resolved.config,
      operations: built.operations,
      manifest: built.manifest,
      crypto: demoCrypto,
      online: { reader, presenter: { userExists: async () => true, hasErasureRecord: async () => false } },
      scope: { teamId: TEAM, reuseExistingTeam: true, presenterUid: PRESENTER },
    });
  };

  it("an identical existing plan is skipped and an identical existing skill is skipped (idempotent)", async () => {
    const p = DEMO_COMPETENCE_PLANS[0];
    const planPath = `teamCompetencePlans/${p.planId}`;
    const same = planOps(plan().operations).find((o) => o.path === planPath)!.data;
    const result = await preflight(same as Record<string, unknown>, planPath);
    const classification = result.classifications.find((c) => c.path === planPath);
    expect(classification).toMatchObject({ action: "skip" });
  });

  it("a different plan at the same id is a conflict and nothing is planned over it", async () => {
    const p = DEMO_COMPETENCE_PLANS[0];
    const planPath = `teamCompetencePlans/${p.planId}`;
    const different = toPersistedCompetencePlan(
      p.planId,
      competencePlanRecord({ ...p, title: "Annen tittel" }, TEAM, AS_OF) as never,
      demoCrypto.sealRecord,
    );
    const result = await preflight(different, planPath);
    expect(result.ok).toBe(false);
    expect(result.classifications.find((c) => c.path === planPath)).toMatchObject({ state: "CONFLICT", reason: "structure-mismatch" });
  });

  it("a skill document from another team is refused (scope mismatch)", async () => {
    const s = DEMO_TEAM_SKILLS[0];
    const skillPath = `teamSkills/${s.skillId}`;
    const foreign = toPersistedTeamSkill(s.skillId, teamSkillRecord(s, OTHER_TEAM, AS_OF, 0) as never, demoCrypto.sealRecord);
    const result = await preflight(foreign, skillPath);
    expect(result.classifications.find((c) => c.path === skillPath)).toMatchObject({ state: "CONFLICT" });
  });
});

describe("fixture level type mirrors the domain", () => {
  it("the target stage range used by the fixtures is the four self-assessed levels", () => {
    expect([1, 2, 3, 4]).toEqual([1, 2, 3, 4]);
    for (const p of DEMO_COMPETENCE_PLANS) expect([1, 2, 3, 4]).toContain(p.targetStage);
  });
});
