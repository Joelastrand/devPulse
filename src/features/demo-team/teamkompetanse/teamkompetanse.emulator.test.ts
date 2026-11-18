import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isValidTeamSkillAssessment, type TeamSkillAssessmentRecord } from "../../team-owned-skills/domain/team-skill-assessment";
import { openAssessmentDocument } from "../../team-owned-skills/server/assessment-level-codec";
import { toPersistedTeamSkill } from "../../team-owned-skills/server/team-skill-codec";
import { readTeamSkillRatingsBatch, type TeamSkillRatingTarget } from "../../team-owned-skills/server/read-team-skill-ratings-batch";
import { deriveTeamLevel } from "../../team-skills/domain/team-level";
import { SKILL_COVERAGE_MIN_CONTRIBUTORS } from "../../team-skills/domain/skill-coverage-policy";
import {
  readSkillContribution,
  SIMULATED_CONTRIBUTION_TEAM_ID,
  SIMULATED_CONTRIBUTION_UIDS,
  SKILL_CONTRIBUTION_FIELD,
} from "../../team-skills/domain/skill-contribution";
import { membershipDocId } from "../../teams/domain/team-membership";
import { DEMO_TEAM_SKILLS, teamSkillRecord } from "../team-catalog-fixtures";
import { bindAdminFirestore } from "./firestore-binding";
import { runTeamkompetanseSeed, type TeamkompetanseReport } from "./live";
import { TEAMKOMPETANSE_AS_OF, TEAMKOMPETANSE_PROFILES } from "./fixtures";
import { buildTeamkompetansePlan } from "./plan";

/**
 * Emulator suite for the Teamkompetanse seeder: real Firebase Admin SDK transactions and reads against the Firestore emulator
 * only. Skipped unless `FIRESTORE_EMULATOR_HOST` and `DEVPULSE_EMULATOR_PROJECT` are set. Each case uses its own fresh `demo-`
 * project, deleted afterwards. No live project is contacted.
 *
 * Auth is a stub here: the emulator suite exercises Firestore semantics (transactions, create-only writes, reads and decryption).
 * The disabled-account rule is covered by the unit suite, which fails closed on any enabled fictional account.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const enabled = Boolean(EMULATOR_HOST) && process.env.DEVPULSE_EMULATOR_PROJECT !== undefined;
const T = SIMULATED_CONTRIBUTION_TEAM_ID;
const CATALOG_AS_OF = new Date("2026-10-01T00:00:00.000Z");
const ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");
const liveId = (index: number) => `lv${String(index + 1).padStart(2, "0")}`;
const liveIdFor = () => new Map(DEMO_TEAM_SKILLS.map((skill, index) => [skill.skillId, liveId(index)]));
const created: string[] = [];

const PLANNED_CONSENTS = SIMULATED_CONTRIBUTION_UIDS.length;
const PLANNED_ASSESSMENTS = buildTeamkompetansePlan({ teamId: T, liveSkillIdFor: liveIdFor() }).assessments.length;

describe.skipIf(!enabled)("Teamkompetanse seeder on the Firestore emulator", () => {
  let adminApp: typeof import("firebase-admin/app");
  let firestore: typeof import("firebase-admin/firestore");
  let credential: unknown;

  beforeAll(async () => {
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    adminApp = await import("firebase-admin/app");
    firestore = await import("firebase-admin/firestore");
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    credential = adminApp.cert({ projectId: "demo-x", clientEmail: "emulator@demo-x.iam.gserviceaccount.com", privateKey });
  }, 60_000);

  afterAll(async () => {
    if (!EMULATOR_HOST) return;
    for (const project of created) {
      await fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
    }
    vi.unstubAllEnvs();
  });

  /** A fresh project: an active team, the ten fictional memberships (no consent yet), and the 25 catalog skills under live ids. */
  async function freshProject() {
    const project = `demo-tk-${Math.random().toString(36).slice(2, 10)}`;
    created.push(project);
    const app = adminApp.initializeApp({ credential: credential as never, projectId: project }, `setup-${project}`);
    const db = firestore.getFirestore(app);
    await db.doc(`teams/${T}`).set({ status: "active" });
    for (const uid of SIMULATED_CONTRIBUTION_UIDS) {
      await db.doc(`teamMemberships/${membershipDocId(uid, T)}`).set({ uid, teamId: T, createdVia: "admin_direct", createdAt: TEAMKOMPETANSE_AS_OF });
    }
    for (const [index, skill] of DEMO_TEAM_SKILLS.entries()) {
      const persisted = toPersistedTeamSkill(liveId(index), teamSkillRecord(skill, T, CATALOG_AS_OF, index));
      await db.doc(`teamSkills/${liveId(index)}`).set(persisted);
    }
    return { project, db };
  }

  function runOn(project: string, db: ReturnType<typeof firestore.getFirestore>, mode: "preflight" | "write") {
    return runTeamkompetanseSeed({
      mode,
      requiredProjectId: project,
      projectId: project,
      teamId: T,
      db: bindAdminFirestore(db),
      auth: { getUser: async (uid) => ({ uid, disabled: true }) },
    });
  }

  /** Read-only: the production ratings reader and codec against the emulator, then the aggregate rule at k = 3. */
  async function aggregateFor(db: ReturnType<typeof firestore.getFirestore>, skillIds: readonly string[]) {
    const targets: TeamSkillRatingTarget[] = skillIds.map((skillId) => ({ skillId, criteriaVersion: 1 }));
    const readRaw = async (keys: ReadonlyArray<{ uid: string; skillId: string }>) => {
      const snapshots = await Promise.all(keys.map(({ uid, skillId }) => db.doc(`teamSkillAssessments/${uid}__${skillId}`).get()));
      return snapshots.map((snapshot) => (snapshot.exists ? mapTimestamps(snapshot.data()) : undefined));
    };
    const ratings = await readTeamSkillRatingsBatch([...SIMULATED_CONTRIBUTION_UIDS], T, targets, { readRaw });
    if (!ratings.ok) throw new Error("ratings read failed");
    return new Map(
      skillIds.map((skillId) => {
        const tally = ratings.bySkill.get(skillId);
        const levels = tally?.levels ?? [];
        if (tally?.suspect || levels.length < SKILL_COVERAGE_MIN_CONTRIBUTORS) return [skillId, { state: "insufficient_data" as const }];
        const derived = deriveTeamLevel(levels, SKILL_COVERAGE_MIN_CONTRIBUTORS);
        return [skillId, derived.state === "value" ? { state: "value" as const, level: derived.level } : { state: "insufficient_data" as const }];
      }),
    );
  }

  it("preflight is read-only; write creates exactly the planned records; read-back is correct and decrypts", async () => {
    const { project, db } = await freshProject();
    const preflight = await runOn(project, db, "preflight");
    expect(preflight.ok).toBe(true);
    expect((await db.collection("teamSkillAssessments").get()).size).toBe(0);

    const report = await runOn(project, db, "write");
    expect(report.ok).toBe(true);
    expect(report.written).toEqual({ consent: PLANNED_CONSENTS, assessments: PLANNED_ASSESSMENTS });
    expect(report.verified).toEqual({ consent: PLANNED_CONSENTS, assessments: PLANNED_ASSESSMENTS });

    const assessments = await db.collection("teamSkillAssessments").where("teamId", "==", T).get();
    expect(assessments.size).toBe(PLANNED_ASSESSMENTS);
    const plan = buildTeamkompetansePlan({ teamId: T, liveSkillIdFor: liveIdFor() });
    for (const planned of plan.assessments.slice(0, 5)) {
      const snapshot = await db.doc(`teamSkillAssessments/${planned.docId}`).get();
      const opened = openAssessmentDocument(planned.uid, T, planned.skillId, mapTimestamps(snapshot.data()));
      expect(isValidTeamSkillAssessment(opened, { uid: planned.uid, skillId: planned.skillId })).toBe(true);
      expect((opened as TeamSkillAssessmentRecord).level).toBe(planned.level);
    }
  }, 120_000);

  it("writes only the consent field on each membership, and every consent reads back as simulated demo consent", async () => {
    const { project, db } = await freshProject();
    const before = await db.doc(`teamMemberships/${membershipDocId("demo-member-03", T)}`).get();
    await runOn(project, db, "write");
    const after = await db.doc(`teamMemberships/${membershipDocId("demo-member-03", T)}`).get();
    expect(withoutConsentField(after.data() ?? {})).toEqual(withoutConsentField(before.data() ?? {}));
    for (const uid of SIMULATED_CONTRIBUTION_UIDS) {
      const membership = await db.doc(`teamMemberships/${membershipDocId(uid, T)}`).get();
      expect(readSkillContribution(membership.data(), { uid, teamId: T })?.origin).toBe("simulated");
    }
  }, 120_000);

  it("an identical rerun writes nothing and still succeeds", async () => {
    const { project, db } = await freshProject();
    await runOn(project, db, "write");
    const again = await runOn(project, db, "write");
    expect(again.ok).toBe(true);
    expect(again.written).toEqual({ consent: 0, assessments: 0 });
    expect((await db.collection("teamSkillAssessments").get()).size).toBe(PLANNED_ASSESSMENTS);
  }, 120_000);

  it("concurrent writes never double-create: across parallel runs each planned record is written exactly once", async () => {
    const { project, db } = await freshProject();
    const reports: TeamkompetanseReport[] = await Promise.all([
      runOn(project, db, "write"),
      runOn(project, db, "write"),
      runOn(project, db, "write"),
    ]);
    expect(reports.every((report) => report.ok)).toBe(true);
    const writtenConsent = reports.reduce((sum, report) => sum + (report.written?.consent ?? 0), 0);
    const writtenAssessments = reports.reduce((sum, report) => sum + (report.written?.assessments ?? 0), 0);
    expect(writtenConsent).toBe(PLANNED_CONSENTS);
    expect(writtenAssessments).toBe(PLANNED_ASSESSMENTS);
    expect((await db.collection("teamSkillAssessments").get()).size).toBe(PLANNED_ASSESSMENTS);
  }, 180_000);

  it("a conflicting consent written after preflight but before the transaction blocks the write on the real emulator", async () => {
    const { project, db } = await freshProject();
    const binding = bindAdminFirestore(db);
    const racing = {
      ...binding,
      runTransaction: async <R>(work: Parameters<typeof binding.runTransaction>[0]) => {
        // Another writer lands a different consent between the preflight reads and this transaction.
        await db.doc(`teamMemberships/${membershipDocId("demo-member-04", T)}`).update({
          [SKILL_CONTRIBUTION_FIELD]: { noticeVersion: 2, consentedAt: new Date("2019-01-01T00:00:00Z"), simulated: true },
        });
        return binding.runTransaction(work) as Promise<R>;
      },
    };
    const report = await runTeamkompetanseSeed({
      mode: "write",
      requiredProjectId: project,
      projectId: project,
      teamId: T,
      db: racing,
      auth: { getUser: async (uid) => ({ uid, disabled: true }) },
    });
    expect(report.ok).toBe(false);
    expect(report.blockers).toContain("consent-conflict-or-unreadable");
    expect((await db.collection("teamSkillAssessments").get()).size).toBe(0);
  }, 120_000);

  it("after the write, the production reader gives the expected team results: k >= 3 holds and suppressed skills stay suppressed", async () => {
    const { project, db } = await freshProject();
    await runOn(project, db, "write");
    const skillIds = DEMO_TEAM_SKILLS.map((_, index) => liveId(index));
    const byLive = await aggregateFor(db, skillIds);
    const fixtureOf = (liveSkill: string) => DEMO_TEAM_SKILLS[skillIds.indexOf(liveSkill)].skillId;

    const typescript = byLive.get(liveId(DEMO_TEAM_SKILLS.findIndex((s) => s.skillId === "skTypescript")));
    expect(typescript).toEqual({ state: "value", level: 3 });
    const trusselmodellering = byLive.get(liveId(DEMO_TEAM_SKILLS.findIndex((s) => s.skillId === "skTrusselmodellering")));
    expect(trusselmodellering).toEqual({ state: "insufficient_data" });
    const datakvalitet = byLive.get(liveId(DEMO_TEAM_SKILLS.findIndex((s) => s.skillId === "skDatakvalitet")));
    expect(datakvalitet).toEqual({ state: "insufficient_data" });

    // Every value the reader returns comes from at least k contributors in the fixture profiles.
    for (const [liveSkill, row] of byLive) {
      const contributors = TEAMKOMPETANSE_PROFILES.filter((p) => p.ratings[fixtureOf(liveSkill)] !== undefined).length;
      if (row.state === "value") expect(contributors).toBeGreaterThanOrEqual(SKILL_COVERAGE_MIN_CONTRIBUTORS);
    }
    expect([...byLive.values()].some((row) => row.state === "value")).toBe(true);
    expect([...byLive.values()].some((row) => row.state === "insufficient_data")).toBe(true);
  }, 120_000);
});

function withoutConsentField(record: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...record };
  delete copy[SKILL_CONTRIBUTION_FIELD];
  return copy;
}

function mapTimestamps(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const field of ["createdAt", "updatedAt"]) {
    const value = out[field];
    if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
      out[field] = (value as { toDate(): Date }).toDate();
    }
  }
  return out;
}

