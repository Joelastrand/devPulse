import "server-only";
import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { StoredRoleDefinition } from "../domain/role-definition";
import { ROLE_LIST_WINDOW } from "../domain/role-definition";
import {
  assertMutableRoleChanges,
  assertRoleIdSegment,
  ROLE_RAW_READ_LIMIT,
  type RawRoleData,
  type RoleFieldChanges,
  type RoleStore,
} from "./role-store-types";

const ROLES_COLLECTION = "roleDefinitions";
const CREATED_AT_FIELD = "createdAt";
const TIMESTAMP_FIELDS: ReadonlySet<string> = new Set(["createdAt", "updatedAt", "archivedAt"]);

function rolesCollection() {
  return getFirestoreDb().collection(ROLES_COLLECTION);
}

function roleRef(roleId: string) {
  assertRoleIdSegment(roleId);
  return rolesCollection().doc(roleId);
}

/**
 * Transaction-bound raw read of one role (PG-7). A plain `get` inside a transaction callback is not transactional, so
 * selection reads the role through the caller's transaction only.
 */
export async function getRoleInTransaction(tx: Transaction, roleId: string): Promise<RawRoleData | undefined> {
  const snapshot = await tx.get(roleRef(roleId));
  return snapshot.exists ? toRawRoleData(snapshot.data() ?? {}) : undefined;
}

/**
 * Persisted representation of a role (AD-1): exactly the stored keys, built field by field, with `Date`s
 * converted to Firestore `Timestamp`s. Optional keys are omitted, never null.
 */
export function toFirestoreRoleData(role: StoredRoleDefinition): Record<string, unknown> {
  return {
    name: role.name,
    expectations: role.expectations.map(({ treeId, expectedLevel }) => ({ treeId, expectedLevel })),
    createdAt: Timestamp.fromDate(role.createdAt),
    createdBy: role.createdBy,
    ...(role.description !== undefined ? { description: role.description } : {}),
    ...(role.updatedAt !== undefined ? { updatedAt: Timestamp.fromDate(role.updatedAt) } : {}),
    ...(role.updatedBy !== undefined ? { updatedBy: role.updatedBy } : {}),
    ...(role.archivedAt !== undefined ? { archivedAt: Timestamp.fromDate(role.archivedAt) } : {}),
    ...(role.archivedBy !== undefined ? { archivedBy: role.archivedBy } : {}),
  };
}

/**
 * Maps top-level Firestore `Timestamp` values to `Date` so no Firestore type leaks past the store. Everything
 * else passes through for the parser to accept or reject; nothing is repaired or normalised.
 */
export function toRawRoleData(data: Record<string, unknown>): RawRoleData {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value instanceof Timestamp ? value.toDate() : value]),
  );
}

function toFirestoreFieldValue(field: string, value: unknown): unknown {
  if (TIMESTAMP_FIELDS.has(field) && value instanceof Date) {
    return Timestamp.fromDate(value);
  }
  return value;
}

/**
 * The Admin SDK implementation of {@link RoleStore} (server-only). Every operation addresses the single
 * `roleDefinitions` collection. There is no filter query and no composite index (AD-7).
 * `generateId` is injectable; by default Firestore generates the auto-id. Firestore errors propagate unchanged.
 */
export function getDefaultRoleStore(options: { generateId?: () => string } = {}): RoleStore {
  return {
    async create(role) {
      const injectedId = options.generateId?.();
      if (injectedId !== undefined) assertRoleIdSegment(injectedId);
      const ref = injectedId !== undefined ? rolesCollection().doc(injectedId) : rolesCollection().doc();
      assertRoleIdSegment(ref.id);
      await ref.create(toFirestoreRoleData(role));
      return ref.id;
    },

    async listWindow() {
      const snapshot = await rolesCollection().orderBy(CREATED_AT_FIELD, "asc").limit(ROLE_RAW_READ_LIMIT).get();
      return {
        docs: snapshot.docs
          .slice(0, ROLE_LIST_WINDOW)
          .map((doc) => ({ id: doc.id, data: toRawRoleData(doc.data()) })),
        rawCount: snapshot.docs.length,
      };
    },

    async count() {
      const snapshot = await rolesCollection().count().get();
      return snapshot.data().count;
    },

    async get(roleId) {
      const snapshot = await roleRef(roleId).get();
      return snapshot.exists ? toRawRoleData(snapshot.data() ?? {}) : undefined;
    },

    async update(roleId, changes: RoleFieldChanges) {
      assertMutableRoleChanges(changes);
      const data: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(changes.set)) {
        data[field] = toFirestoreFieldValue(field, value);
      }
      for (const field of changes.unset) {
        data[field] = FieldValue.delete();
      }
      await roleRef(roleId).update(data);
    },
  };
}
