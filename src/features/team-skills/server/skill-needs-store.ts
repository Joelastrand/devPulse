import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { membershipDocId } from "../../teams/domain/team-membership";
import { isValidSkillNeed, type SkillNeedRecord } from "../domain/skill-need";
import type { GenuineMembershipReads } from "./genuine-team-membership";

const SKILL_NEEDS_COLLECTION = "teamSkillNeeds";

/** Valid-candidate window of one need read; one extra raw document is requested only as the truncation probe (SPEC BR-4). */
export const SKILL_NEEDS_LIST_MAX = 500;

export interface ListedSkillNeeds {
  needs: SkillNeedRecord[];
  /** `true` iff a 501st raw document exists (the first 500 are the window). */
  truncated: boolean;
}

/** One raw `teamSkillNeeds` document: Firestore id plus unvalidated data. */
export interface RawNeedDoc {
  id: string;
  data: unknown;
}

/** Raw, unvalidated query seam; satisfied by Firestore in production and fakes in tests. No write method exists. */
export interface SkillNeedsReader {
  listByTeam(teamId: string, limit: number): Promise<RawNeedDoc[]>;
}

export interface SkillNeedsStore {
  listNeeds(teamId: string, limit?: number): Promise<ListedSkillNeeds>;
}

/**
 * Reads and writes inside one need-mutation transaction. Every read must come
 * before the first write. `reads` has the shape of the genuine-membership seam so
 * the lead decision is made from in-transaction state.
 */
export interface SkillNeedWriteTx {
  reads: GenuineMembershipReads;
  /** Raw `skillTrees/{treeId}` data, or `undefined` if absent. */
  getSkillTree(treeId: string): Promise<unknown>;
  /** Raw (dates mapped) `teamSkillNeeds/{docId}` data, or `undefined` if absent. Not validated. */
  getNeed(docId: string): Promise<unknown>;
  /** Replaces the whole document at the deterministic slot. */
  putNeed(docId: string, record: SkillNeedRecord): void;
  deleteNeed(docId: string): void;
}

export interface SkillNeedWriteStore {
  runTransaction<T>(fn: (tx: SkillNeedWriteTx) => Promise<T>): Promise<T>;
}

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const SKILL_TREES_COLLECTION = "skillTrees";

/** Admin SDK transaction: team, membership and tree reads plus the need slot, decided and written atomically. */
export function getDefaultSkillNeedWriteStore(): SkillNeedWriteStore {
  return {
    runTransaction(fn) {
      const db = getFirestoreDb();
      return db.runTransaction((tx) =>
        fn({
          reads: {
            async getTeamStatus(teamId) {
              const snapshot = await tx.get(db.collection(TEAMS_COLLECTION).doc(teamId));
              return snapshot.exists ? snapshot.data()?.status : undefined;
            },
            async getMembership(uid, teamId) {
              const snapshot = await tx.get(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)));
              return snapshot.exists ? snapshot.data() : undefined;
            },
          },
          async getSkillTree(treeId) {
            const snapshot = await tx.get(db.collection(SKILL_TREES_COLLECTION).doc(treeId));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          async getNeed(docId) {
            const snapshot = await tx.get(db.collection(SKILL_NEEDS_COLLECTION).doc(docId));
            return snapshot.exists ? mapNeedDates(snapshot.data()) : undefined;
          },
          putNeed(docId, record) {
            tx.set(db.collection(SKILL_NEEDS_COLLECTION).doc(docId), record);
          },
          deleteNeed(docId) {
            tx.delete(db.collection(SKILL_NEEDS_COLLECTION).doc(docId));
          },
        }),
      );
    },
  };
}

function toDate(value: unknown): unknown {
  if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return value;
}

function mapNeedDates(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const field of ["createdAt", "updatedAt"]) {
    if (field in out) out[field] = toDate(out[field]);
  }
  return out;
}

function getDefaultReader(): SkillNeedsReader {
  return {
    async listByTeam(teamId, limit) {
      // Single-field equality query: served by the automatic index, no composite index.
      const snapshot = await getFirestoreDb()
        .collection(SKILL_NEEDS_COLLECTION)
        .where("teamId", "==", teamId)
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: mapNeedDates(doc.data()) }));
    },
  };
}

/**
 * The only production module that names `teamSkillNeeds` (reads above,
 * mutation transaction via `getDefaultSkillNeedWriteStore`).
 * Invalid documents — wrong shape, document id not equal to the stored
 * identity, or stored `teamId` different from the requested team — are skipped,
 * never repaired or returned. A read failure rejects; it is never an empty list.
 */
export function getDefaultSkillNeedsStore(reader: SkillNeedsReader = getDefaultReader()): SkillNeedsStore {
  return {
    async listNeeds(teamId, limit = SKILL_NEEDS_LIST_MAX) {
      const raw = await reader.listByTeam(teamId, limit + 1);
      const needs: SkillNeedRecord[] = [];
      for (const { id, data } of raw.slice(0, limit)) {
        if (isValidSkillNeed(data, { docId: id }) && data.teamId === teamId) needs.push(data);
      }
      return { needs, truncated: raw.length > limit };
    },
  };
}
