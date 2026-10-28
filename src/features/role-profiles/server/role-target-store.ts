import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { getRoleInTransaction, toRawRoleData } from "./role-store";
import { createTransactionSkillTreeReader } from "./skill-tree-seam";
import { assertSubjectUidSegment, type RoleTargetStore, type RoleTargetWrite } from "./role-target-store-types";

const USER_DEVELOPMENT_COLLECTION = "userDevelopment";
const ROLE_TARGET_COLLECTION = "roleTarget";
const ROLE_TARGET_DOCUMENT_ID = "current";

/** The single fixed document for one owner: at most one target is structural (AD-2). */
function roleTargetRef(subjectUid: string) {
  assertSubjectUidSegment(subjectUid);
  return getFirestoreDb()
    .collection(USER_DEVELOPMENT_COLLECTION)
    .doc(subjectUid)
    .collection(ROLE_TARGET_COLLECTION)
    .doc(ROLE_TARGET_DOCUMENT_ID);
}

/** Persisted target: exactly `roleId` and `updatedAt`, with the date written as a Firestore `Timestamp`. */
function toFirestoreTargetData(target: RoleTargetWrite): Record<string, unknown> {
  return { roleId: target.roleId, updatedAt: Timestamp.fromDate(target.updatedAt) };
}

/**
 * The Admin SDK implementation of {@link RoleTargetStore} (server-only). Reads, deletes and selection writes address the
 * owner's own document only. Firestore errors propagate unchanged; a read failure is never reported as absence.
 */
export function getDefaultRoleTargetStore(): RoleTargetStore {
  return {
    async get(subjectUid) {
      const snapshot = await roleTargetRef(subjectUid).get();
      return snapshot.exists ? toRawRoleData(snapshot.data() ?? {}) : undefined;
    },

    async delete(subjectUid) {
      await roleTargetRef(subjectUid).delete();
    },

    async runSelection(subjectUid, work) {
      const ref = roleTargetRef(subjectUid);
      return getFirestoreDb().runTransaction(async (tx) => {
        let written = false;
        return work({
          async readRole(roleId) {
            if (written) throw new Error("role read after the selection write");
            return getRoleInTransaction(tx, roleId);
          },
          trees: {
            async getMany(treeIds) {
              if (written) throw new Error("SkillTree read after the selection write");
              return createTransactionSkillTreeReader(tx).getMany(treeIds);
            },
          },
          writeTarget(target) {
            written = true;
            tx.set(ref, toFirestoreTargetData(target));
          },
        });
      });
    },
  };
}
