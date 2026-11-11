import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { membershipDocId } from "../../teams/domain/team-membership";
import type { TeamSkillRecord } from "../domain/team-skill";
import { teamSkillAssessmentDocId, type TeamSkillAssessmentRecord } from "../domain/team-skill-assessment";

export const TEAM_SKILLS_COLLECTION = "teamSkills";
export const TEAM_SKILL_ASSESSMENTS_COLLECTION = "teamSkillAssessments";
const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const DATE_FIELDS = ["createdAt", "updatedAt"] as const;

/** A raw document with its id and unvalidated data (timestamps already mapped to `Date`). */
export interface RawDoc {
  id: string;
  data: unknown;
}

/**
 * Transaction seam. All reads of an operation happen before its first write. Raw values are returned unvalidated; the
 * domain decides what they mean.
 */
export interface TeamSkillTx {
  getTeamStatus(teamId: string): Promise<unknown>;
  getMembership(uid: string, teamId: string): Promise<unknown>;
  listSkills(teamId: string, limit: number): Promise<RawDoc[]>;
  getSkill(skillId: string): Promise<unknown>;
  putSkill(skillId: string, record: TeamSkillRecord): void;
  /** Raw `teamSkillAssessments/{uid}__{skillId}` data, or `undefined` when absent. */
  getAssessment(uid: string, skillId: string): Promise<unknown>;
  /** The caller's own ratings in one team (`where uid ==`, `where teamId ==`), at most `limit`. */
  listOwnAssessments(uid: string, teamId: string, limit: number): Promise<RawDoc[]>;
  putAssessment(record: TeamSkillAssessmentRecord): void;
  deleteAssessment(uid: string, skillId: string): void;
}

export interface TeamSkillStore {
  /** A fresh stable identity: a Firestore auto-id, alphanumeric by construction. */
  newSkillId(): string;
  runTransaction<T>(work: (tx: TeamSkillTx) => Promise<T>): Promise<T>;
}

function mapDates(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const field of DATE_FIELDS) {
    const value = out[field];
    if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
      out[field] = (value as { toDate(): Date }).toDate();
    }
  }
  return out;
}

export function getDefaultTeamSkillStore(): TeamSkillStore {
  return {
    newSkillId() {
      // Firestore auto-ids are 20 alphanumeric characters; the operation refuses any id outside the domain pattern.
      return getFirestoreDb().collection(TEAM_SKILLS_COLLECTION).doc().id;
    },
    runTransaction(work) {
      const db = getFirestoreDb();
      return db.runTransaction((tx) =>
        work({
          async getTeamStatus(teamId) {
            const snapshot = await tx.get(db.collection(TEAMS_COLLECTION).doc(teamId));
            return snapshot.exists ? snapshot.data()?.status : undefined;
          },
          async getMembership(uid, teamId) {
            const snapshot = await tx.get(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          async listSkills(teamId, limit) {
            const snapshot = await tx.get(db.collection(TEAM_SKILLS_COLLECTION).where("teamId", "==", teamId).limit(limit));
            return snapshot.docs.map((doc) => ({ id: doc.id, data: mapDates(doc.data()) }));
          },
          async getSkill(skillId) {
            const snapshot = await tx.get(db.collection(TEAM_SKILLS_COLLECTION).doc(skillId));
            return snapshot.exists ? mapDates(snapshot.data()) : undefined;
          },
          putSkill(skillId, record) {
            tx.set(db.collection(TEAM_SKILLS_COLLECTION).doc(skillId), record);
          },
          async getAssessment(uid, skillId) {
            const snapshot = await tx.get(db.collection(TEAM_SKILL_ASSESSMENTS_COLLECTION).doc(teamSkillAssessmentDocId(uid, skillId)));
            return snapshot.exists ? mapDates(snapshot.data()) : undefined;
          },
          async listOwnAssessments(uid, teamId, limit) {
            const snapshot = await tx.get(
              db
                .collection(TEAM_SKILL_ASSESSMENTS_COLLECTION)
                .where("uid", "==", uid)
                .where("teamId", "==", teamId)
                .limit(limit),
            );
            return snapshot.docs.map((doc) => ({ id: doc.id, data: mapDates(doc.data()) }));
          },
          putAssessment(record) {
            tx.set(db.collection(TEAM_SKILL_ASSESSMENTS_COLLECTION).doc(teamSkillAssessmentDocId(record.uid, record.skillId)), record);
          },
          deleteAssessment(uid, skillId) {
            tx.delete(db.collection(TEAM_SKILL_ASSESSMENTS_COLLECTION).doc(teamSkillAssessmentDocId(uid, skillId)));
          },
        }),
      );
    },
  };
}
