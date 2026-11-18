import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isValidTeamSkillAssessment, type TeamSkillAssessmentRecord } from "../../team-owned-skills/domain/team-skill-assessment";
import { openAssessmentDocument, sealAssessmentLevel } from "../../team-owned-skills/server/assessment-level-codec";
import { toPersistedTeamSkill } from "../../team-owned-skills/server/team-skill-codec";
import { SIMULATED_CONTRIBUTION_TEAM_ID, SIMULATED_CONTRIBUTION_UIDS, readSkillContribution } from "../../team-skills/domain/skill-contribution";
import { membershipDocId } from "../../teams/domain/team-membership";
import { DEMO_TEAM_SKILLS, teamSkillRecord } from "../team-catalog-fixtures";
import { bindAdminFirestore } from "./firestore-binding";
import { mapTimestamps, runTeamkompetanseSeed } from "./live";
import { TEAMKOMPETANSE_AS_OF, TEAMKOMPETANSE_RATING_UPDATE_AS_OF } from "./fixtures";
import { RATING_CHANGES, runRatingUpdate, type RatingUpdateReport } from "./rating-update";
import { buildTeamkompetansePlan, type PlannedAssessment } from "./plan";

/**
 * Emulator suite for the approved rating update. Real Admin SDK transactions against the Firestore emulator only; skipped
 * unless `FIRESTORE_EMULATOR_HOST` and `DEVPULSE_EMULATOR_PROJECT` are set. Each case uses its own fresh `demo-` project,
 * deleted afterwards. The starting state reproduces the live pre-update state: the original seed, with the 20 approved
 * records reverted to their old levels.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const enabled = Boolean(EMULATOR_HOST) && process.env.DEVPULSE_EMULATOR_PROJECT !== undefined;
const T = SIMULATED_CONTRIBUTION_TEAM_ID;
const CATALOG_AS_OF = new Date("2026-10-01T00:00:00.000Z");
const ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");
const liveId = (index: number) => `lv${String(index + 1).padStart(2, "0")}`;
const liveIdFor = () => new Map(DEMO_TEAM_SKILLS.map((skill, index) => [skill.skillId, liveId(index)]));
const created: string[] = [];

const plan = () => buildTeamkompetansePlan({ teamId: T, liveSkillIdFor: liveIdFor() });
const auth = { getUser: async (uid: string) => ({ uid, disabled: true }) };

describe.skipIf(!enabled)("approved rating update on the Firestore emulator", () => {
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

  type Db = ReturnType<typeof firestore.getFirestore>;

  /** Every field except the two the update is allowed to change. */
  function withoutLevelAndUpdatedAt(data: Record<string, unknown>): Record<string, unknown> {
    const copy = { ...data };
    delete copy.level;
    delete copy.updatedAt;
    return copy;
  }

  /** A project in the live pre-update state: the original seed, with the 20 approved records reverted to their old levels. */
  async function preUpdateProject(): Promise<{ project: string; db: Db }> {
    const project = `demo-ru-${Math.random().toString(36).slice(2, 10)}`;
    created.push(project);
    const app = adminApp.initializeApp({ credential: credential as never, projectId: project }, `setup-${project}`);
    const db = firestore.getFirestore(app);
    await db.doc(`teams/${T}`).set({ status: "active" });
    for (const uid of SIMULATED_CONTRIBUTION_UIDS) {
      await db.doc(`teamMemberships/${membershipDocId(uid, T)}`).set({ uid, teamId: T, createdVia: "admin_direct", createdAt: TEAMKOMPETANSE_AS_OF });
    }
    for (const [index, skill] of DEMO_TEAM_SKILLS.entries()) {
      await db.doc(`teamSkills/${liveId(index)}`).set(toPersistedTeamSkill(liveId(index), teamSkillRecord(skill, T, CATALOG_AS_OF, index)));
    }
    // Seed the new plan, then revert the 20 approved records to the old levels, as they are live.
    const seeded = await runTeamkompetanseSeed({
      mode: "write",
      requiredProjectId: project,
      projectId: project,
      teamId: T,
      db: bindAdminFirestore(db),
      auth,
    });
    if (seeded.written === null) throw new Error("setup: seed did not write");
    const byId = new Map(plan().assessments.map((planned) => [`${planned.uid}|${planned.skillId}`, planned]));
    for (const change of RATING_CHANGES) {
      const liveSkillId = liveIdFor().get(change.fixtureSkillId);
      if (liveSkillId === undefined) throw new Error("setup: no live skill");
      const planned = byId.get(`${change.uid}|${liveSkillId}`);
      if (planned === undefined) throw new Error("setup: change has no planned assessment");
      await db.doc(`teamSkillAssessments/${planned.docId}`).update({ level: sealAssessmentLevel(change.uid, T, liveSkillId, change.from) });
    }
    return { project, db };
  }

  function run(project: string, db: Db, mode: "preflight" | "write"): Promise<RatingUpdateReport> {
    return runRatingUpdate({ mode, requiredProjectId: project, projectId: project, teamId: T, db: bindAdminFirestore(db), auth });
  }

  async function levelOf(db: Db, planned: PlannedAssessment): Promise<number | null> {
    const snapshot = await db.doc(`teamSkillAssessments/${planned.docId}`).get();
    const opened = openAssessmentDocument(planned.uid, T, planned.skillId, mapTimestamps(snapshot.data()));
    return isValidTeamSkillAssessment(opened, { uid: planned.uid, skillId: planned.skillId })
      ? (opened as TeamSkillAssessmentRecord).level
      : null;
  }

  it("preflight is read-only and reports exactly the 20 approved updates against the live pre-update state", async () => {
    const { project, db } = await preUpdateProject();
    const before = await db.collection("teamSkillAssessments").get();

    const report = await run(project, db, "preflight");

    expect(report.ok).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.assessments).toEqual({ identical: 89, update: 20, conflict: 0, unreadable: 0 });
    const after = await db.collection("teamSkillAssessments").get();
    expect(after.size).toBe(before.size);
    expect(report.written).toBeNull();
  }, 180_000);

  it("writes exactly the 20 approved levels, and every other field of every record is unchanged", async () => {
    const { project, db } = await preUpdateProject();
    const beforeDocs = new Map((await db.collection("teamSkillAssessments").get()).docs.map((doc) => [doc.id, doc.data()]));

    const report = await run(project, db, "write");

    expect(report.ok).toBe(true);
    expect(report.written).toBe(20);
    expect(report.verified).toEqual({ identical: 109, update: 0, conflict: 0, unreadable: 0 });
    const afterDocs = await db.collection("teamSkillAssessments").get();
    expect(afterDocs.size).toBe(109);

    const changedKeys = new Set(RATING_CHANGES.map((change) => `${change.uid}__${liveIdFor().get(change.fixtureSkillId)}`));
    for (const doc of afterDocs.docs) {
      const before = beforeDocs.get(doc.id) ?? {};
      const after = doc.data() as Record<string, unknown>;
      expect(withoutLevelAndUpdatedAt(after)).toEqual(withoutLevelAndUpdatedAt(before));
      if (changedKeys.has(doc.id)) {
        expect(mapTimestamps({ updatedAt: after.updatedAt })).toEqual({ updatedAt: TEAMKOMPETANSE_RATING_UPDATE_AS_OF });
      } else {
        expect(after.updatedAt).toEqual((before as Record<string, unknown>).updatedAt);
      }
    }
  }, 180_000);

  it("the updated levels read back as the approved target, with the same ownership and creation time", async () => {
    const { project, db } = await preUpdateProject();
    await run(project, db, "write");

    for (const change of RATING_CHANGES) {
      const liveSkillId = liveIdFor().get(change.fixtureSkillId) ?? "";
      const planned = plan().assessments.find((item) => item.uid === change.uid && item.skillId === liveSkillId);
      if (planned === undefined) throw new Error("test: no planned assessment");
      expect(await levelOf(db, planned)).toBe(change.to);
    }
  }, 180_000);

  it("keeps the consent records and membership documents unchanged", async () => {
    const { project, db } = await preUpdateProject();
    const beforeConsent = new Map(
      await Promise.all(SIMULATED_CONTRIBUTION_UIDS.map(async (uid) => [uid, (await db.doc(`teamMemberships/${membershipDocId(uid, T)}`).get()).data()] as const)),
    );

    await run(project, db, "write");

    for (const uid of SIMULATED_CONTRIBUTION_UIDS) {
      const after = (await db.doc(`teamMemberships/${membershipDocId(uid, T)}`).get()).data();
      expect(after).toEqual(beforeConsent.get(uid));
      expect(readSkillContribution(after, { uid, teamId: T })?.origin).toBe("simulated");
    }
  }, 180_000);

  it("an identical rerun writes nothing and succeeds", async () => {
    const { project, db } = await preUpdateProject();
    await run(project, db, "write");

    const rerun = await run(project, db, "write");

    expect(rerun.ok).toBe(true);
    expect(rerun.written).toBe(0);
    expect(rerun.assessments).toEqual({ identical: 109, update: 0, conflict: 0, unreadable: 0 });
  }, 180_000);

  it("refuses to write when one record holds an unexpected level, and changes nothing", async () => {
    const { project, db } = await preUpdateProject();
    const change = RATING_CHANGES[0];
    const liveSkillId = liveIdFor().get(change.fixtureSkillId) ?? "";
    await db.doc(`teamSkillAssessments/${change.uid}__${liveSkillId}`).update({
      level: sealAssessmentLevel(change.uid, T, liveSkillId, 1),
    });
    const beforeCount = (await db.collection("teamSkillAssessments").get()).size;

    const report = await run(project, db, "write");

    expect(report.ok).toBe(false);
    expect(report.blockers).toEqual(["assessment-gate-failed"]);
    // Refused at preflight: no transaction was attempted, so nothing is reported as written.
    expect(report.written).toBeNull();
    expect(report.assessments.conflict).toBe(1);
    expect((await db.collection("teamSkillAssessments").get()).size).toBe(beforeCount);
  }, 180_000);

  it("concurrent writes apply each approved change once: the first writes, the second finds the target and writes nothing", async () => {
    const { project, db } = await preUpdateProject();

    const [first, second] = await Promise.all([run(project, db, "write"), run(project, db, "write")]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect((first.written ?? 0) + (second.written ?? 0)).toBe(20);
    expect(first.verified?.identical).toBe(109);
    expect(second.verified?.identical).toBe(109);
  }, 240_000);
});
