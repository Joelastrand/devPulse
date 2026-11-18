import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { SIMULATED_CONTRIBUTION_UIDS } from "../../team-skills/domain/skill-contribution";
import { sealAssessmentLevel } from "../../team-owned-skills/server/assessment-level-codec";
import { DEMO_TEAM_SKILLS } from "../team-catalog-fixtures";
import { TEAMKOMPETANSE_AS_OF, TEAMKOMPETANSE_PROFILES, TEAMKOMPETANSE_RATING_UPDATE_AS_OF } from "./fixtures";
import { classifyRatingUpdate, RATING_CHANGES, ratingUpdatePlanDigest, runRatingUpdate } from "./rating-update";
import type { PlannedAssessment } from "./plan";

const T = "8yB2bS8Jav69TCfDETON";
const ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");

describe("approved rating changes", () => {
  it("lists exactly 20 changes, each for a fictional member and a catalog skill, on the 1-4 scale", () => {
    expect(RATING_CHANGES).toHaveLength(20);
    for (const change of RATING_CHANGES) {
      expect(SIMULATED_CONTRIBUTION_UIDS).toContain(change.uid);
      expect(DEMO_TEAM_SKILLS.map((skill) => skill.skillId)).toContain(change.fixtureSkillId);
      expect([1, 2, 3, 4]).toContain(change.from);
      expect([1, 2, 3, 4]).toContain(change.to);
      expect(change.from).not.toBe(change.to);
    }
  });

  it("lists each member and skill at most once", () => {
    const keys = RATING_CHANGES.map((change) => `${change.uid}|${change.fixtureSkillId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("matches the fixture: each change's target is the rating the fixture now holds", () => {
    for (const change of RATING_CHANGES) {
      const profile = TEAMKOMPETANSE_PROFILES.find((item) => item.uid === change.uid);
      expect(profile?.ratings[change.fixtureSkillId]).toBe(change.to);
    }
  });

  it("only moves an existing rating: no change adds or removes a rated area", () => {
    for (const change of RATING_CHANGES) {
      const profile = TEAMKOMPETANSE_PROFILES.find((item) => item.uid === change.uid);
      expect(profile?.ratings[change.fixtureSkillId]).toBeDefined();
    }
  });
});

/** A database stand-in that fails the test on any access. The gate must refuse before reading or writing. */
function untouchableDb() {
  const touch = vi.fn(() => {
    throw new Error("database accessed before the confirmation gate");
  });
  return { db: { doc: touch, get: touch, runTransaction: touch, collection: touch } as never, touch };
}

const noAuth = { getUser: vi.fn(async () => ({ uid: "x", disabled: false })) };

describe("rating-update: controlled write gate", () => {
  it("derives a stable 16-hex-digit digest for the exact project, team and approved batch", () => {
    const digest = ratingUpdatePlanDigest({ requiredProjectId: "devpulse-nve", teamId: T });

    expect(digest).toMatch(/^[0-9a-f]{16}$/);
    expect(ratingUpdatePlanDigest({ requiredProjectId: "devpulse-nve", teamId: T })).toBe(digest);
  });

  it("changes the digest when the project or the team differs", () => {
    const digest = ratingUpdatePlanDigest({ requiredProjectId: "devpulse-nve", teamId: T });

    expect(ratingUpdatePlanDigest({ requiredProjectId: "other-project", teamId: T })).not.toBe(digest);
    expect(ratingUpdatePlanDigest({ requiredProjectId: "devpulse-nve", teamId: "other-team" })).not.toBe(digest);
  });

  it("refuses a write with no confirmation before any database access", async () => {
    const { db, touch } = untouchableDb();

    const report = await runRatingUpdate({ mode: "write", requiredProjectId: "devpulse-nve", projectId: "devpulse-nve", teamId: T, db, auth: noAuth });

    expect(report.blockers).toEqual(["confirmation-required"]);
    expect(report.ok).toBe(false);
    expect(report.written).toBeNull();
    expect(touch).not.toHaveBeenCalled();
  });

  it("refuses a write whose confirmation is not the digest of this batch, before any database access", async () => {
    const { db, touch } = untouchableDb();

    const report = await runRatingUpdate({
      mode: "write",
      requiredProjectId: "devpulse-nve",
      projectId: "devpulse-nve",
      teamId: T,
      confirmDigest: "0000000000000000",
      db,
      auth: noAuth,
    });

    expect(report.blockers).toEqual(["confirmation-mismatch"]);
    expect(report.written).toBeNull();
    expect(touch).not.toHaveBeenCalled();
  });

  it("reports the digest in every report, so the operator can quote the batch they reviewed", async () => {
    const { db } = untouchableDb();

    const report = await runRatingUpdate({ mode: "write", requiredProjectId: "devpulse-nve", projectId: "devpulse-nve", teamId: T, db, auth: noAuth });

    expect(report.planDigest).toBe(ratingUpdatePlanDigest({ requiredProjectId: "devpulse-nve", teamId: T }));
  });

  it("refuses a wrong project before the confirmation check, with no database access", async () => {
    const { db, touch } = untouchableDb();

    const report = await runRatingUpdate({ mode: "write", requiredProjectId: "devpulse-nve", projectId: "other", teamId: T, db, auth: noAuth });

    expect(report.blockers).toEqual(["project-mismatch"]);
    expect(touch).not.toHaveBeenCalled();
  });
});

describe("classifyRatingUpdate", () => {
  beforeAll(() => vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY));
  afterAll(() => vi.unstubAllEnvs());

  const change = RATING_CHANGES[0];
  const liveSkillId = "lv01";
  const planned = (level: 1 | 2 | 3 | 4, uid = change.uid): PlannedAssessment => ({
    uid,
    skillId: liveSkillId,
    level,
    docId: `${uid}__${liveSkillId}`,
    data: {},
  });

  /** A stored record as the seeder writes it, with the level sealed for `level` under the given owner. */
  function stored(level: 1 | 2 | 3 | 4, options: { uid?: string; createdAt?: Date } = {}) {
    const uid = options.uid ?? change.uid;
    return {
      exists: true,
      data: () => ({
        uid,
        teamId: T,
        skillId: liveSkillId,
        level: sealAssessmentLevel(uid, T, liveSkillId, level),
        criteriaVersion: 1,
        createdAt: options.createdAt ?? TEAMKOMPETANSE_AS_OF,
        updatedAt: TEAMKOMPETANSE_AS_OF,
      }),
    };
  }

  it("treats a stored level equal to the target as identical", () => {
    expect(classifyRatingUpdate(planned(change.to), change, T, stored(change.to))).toBe("identical");
  });

  it("accepts an update only for a listed change whose stored level is the approved old value", () => {
    expect(classifyRatingUpdate(planned(change.to), change, T, stored(change.from))).toBe("update");
  });

  it("refuses an unlisted level, so an unexpected value is never overwritten", () => {
    const other = ([1, 2, 3, 4] as const).find((level) => level !== change.from && level !== change.to) ?? 1;
    expect(classifyRatingUpdate(planned(change.to), change, T, stored(other))).toBe("conflict");
  });

  it("refuses an old value when the record is not a listed change", () => {
    expect(classifyRatingUpdate(planned(change.to), undefined, T, stored(change.from))).toBe("conflict");
  });

  it("refuses a missing record", () => {
    expect(classifyRatingUpdate(planned(change.to), change, T, { exists: false, data: () => undefined })).toBe("conflict");
  });

  it("refuses a record whose creation time is not the approved synthetic creation time", () => {
    const createdAt = new Date("2026-02-01T00:00:00.000Z");
    expect(classifyRatingUpdate(planned(change.to), change, T, stored(change.from, { createdAt }))).toBe("conflict");
  });

  it("marks a ciphertext moved to another member as unreadable, because the authenticated context no longer matches", () => {
    const otherMember = SIMULATED_CONTRIBUTION_UIDS.find((uid) => uid !== change.uid) ?? change.uid;
    const moved = stored(change.from, { uid: otherMember });
    const data = moved.data();
    const relabelled = { exists: true, data: () => ({ ...data, uid: change.uid }) };
    expect(classifyRatingUpdate(planned(change.to), change, T, relabelled)).toBe("unreadable");
  });

  it("names the approved update timestamp as a constant distinct from the creation time", () => {
    expect(TEAMKOMPETANSE_RATING_UPDATE_AS_OF.getTime()).not.toBe(TEAMKOMPETANSE_AS_OF.getTime());
  });
});
