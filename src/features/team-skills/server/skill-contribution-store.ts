import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { membershipDocId } from "../../teams/domain/team-membership";
import { SKILL_CONTRIBUTION_FIELD, type SkillContributionRecord } from "../domain/skill-contribution";
import type { GenuineMembershipReads } from "./genuine-team-membership";

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * Reads and writes inside one participation transaction, scoped to the caller's
 * own membership document. Every read must come before the first write. The
 * writers only ever `update` the single participation field, so they can neither
 * create a missing membership nor touch any other field.
 */
export interface SkillContributionTx {
  reads: GenuineMembershipReads;
  /** Queues an `update` of the participation field on the caller's membership. */
  setField(uid: string, teamId: string, record: SkillContributionRecord): void;
  /** Queues an `update` that deletes the field; no tombstone or negative state. */
  deleteField(uid: string, teamId: string): void;
}

/** Raw membership document of one team, as listed for the coverage derivation. */
export interface RawMembershipDoc {
  id: string;
  data: unknown;
}

export interface SkillContributionStore {
  runTransaction<T>(fn: (tx: SkillContributionTx) => Promise<T>): Promise<T>;
  /** Raw membership documents of a team (`where teamId ==`, no composite index); consumed by the coverage reader. */
  listMembershipsForCoverage(teamId: string, limit: number): Promise<RawMembershipDoc[]>;
}

/**
 * The only production module that writes the participation field or lists
 * membership documents for C2. Admin SDK transaction: team and membership are
 * read and the one field is updated atomically, so a membership removed in
 * between makes the commit fail instead of being recreated.
 */
export function getDefaultSkillContributionStore(): SkillContributionStore {
  return {
    runTransaction(fn) {
      const db = getFirestoreDb();
      const membershipRef = (uid: string, teamId: string) =>
        db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId));
      return db.runTransaction((tx) =>
        fn({
          reads: {
            async getTeamStatus(teamId) {
              const snapshot = await tx.get(db.collection(TEAMS_COLLECTION).doc(teamId));
              return snapshot.exists ? snapshot.data()?.status : undefined;
            },
            async getMembership(uid, teamId) {
              const snapshot = await tx.get(membershipRef(uid, teamId));
              return snapshot.exists ? snapshot.data() : undefined;
            },
          },
          setField(uid, teamId, record) {
            tx.update(membershipRef(uid, teamId), { [SKILL_CONTRIBUTION_FIELD]: record });
          },
          deleteField(uid, teamId) {
            tx.update(membershipRef(uid, teamId), { [SKILL_CONTRIBUTION_FIELD]: FieldValue.delete() });
          },
        }),
      );
    },
    async listMembershipsForCoverage(teamId, limit) {
      const snapshot = await getFirestoreDb()
        .collection(MEMBERSHIPS_COLLECTION)
        .where("teamId", "==", teamId)
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
  };
}
