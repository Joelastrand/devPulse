import "server-only";
import { Timestamp, type Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { RawSkillTreeRead, RawSkillTreeReader } from "./skill-tree-seam-types";

const SKILL_TREES_COLLECTION = "skillTrees";

/**
 * Firestore `Timestamp` values are mapped to `Date` before validation, because `isValidSkillTree` checks
 * `Date`s. Other values pass through unchanged; nothing is repaired.
 */
function toCandidateSkillTree(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value instanceof Timestamp ? value.toDate() : value]),
  );
}

function toRawRead(id: string, exists: boolean, data: Record<string, unknown> | undefined): RawSkillTreeRead {
  return { id, data: exists && data !== undefined ? toCandidateSkillTree(data) : undefined };
}

/**
 * Admin SDK batch reader outside any transaction. Read-only: `getAll` only; no `set`, `update`, `create`,
 * `delete` or batch write.
 */
export function getDefaultSkillTreeReader(): RawSkillTreeReader {
  return {
    async getMany(treeIds) {
      const db = getFirestoreDb();
      const snapshots = await db.getAll(...treeIds.map((id) => db.collection(SKILL_TREES_COLLECTION).doc(id)));
      return snapshots.map((snapshot) => toRawRead(snapshot.id, snapshot.exists, snapshot.data()));
    },
  };
}

/**
 * Reader bound to a caller's Firestore transaction, so a SkillTree read inside `runTransaction` is a genuine
 * transactional read (`tx.get`). A plain `db.get` inside a transaction callback is NOT transactional (PG-7).
 */
export function createTransactionSkillTreeReader(tx: Transaction): RawSkillTreeReader {
  const db = getFirestoreDb();
  return {
    async getMany(treeIds) {
      return Promise.all(
        treeIds.map(async (id) => {
          const snapshot = await tx.get(db.collection(SKILL_TREES_COLLECTION).doc(id));
          return toRawRead(snapshot.id, snapshot.exists, snapshot.data());
        }),
      );
    },
  };
}
