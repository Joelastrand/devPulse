import { ROLE_LIST_WINDOW, type StoredRoleDefinition } from "../domain/role-definition";

/**
 * Persistence contract for role-definition documents keyed by `roleId` (TASK-005; AD-1, AD-7, PG-5). Pure types and helpers shared
 * by the Admin SDK store and the in-memory fake; imports nothing from Firebase so the fake stays Firebase-free.
 *
 * The store is a persistence boundary only. It returns raw material and never validates, classifies, filters
 * by archive state, authorizes or maps errors. Validation is `parseStoredRoleDefinition` (TASK-001).
 */

/** Raw stored data with top-level Firestore `Timestamp`s already mapped to `Date`; never validated. */
export type RawRoleData = Record<string, unknown>;

export interface RawRoleDoc {
  id: string;
  data: RawRoleData;
}

/** Size of the bounded raw list read: the 50-document window plus one truncation probe (BR-22, PG-5). */
export const ROLE_RAW_READ_LIMIT = ROLE_LIST_WINDOW + 1;

/**
 * Result of the ordered list read. `docs` is the window: at most the first 50 raw documents in query order.
 * `rawCount` is what the query returned (at most 51); a `rawCount` of 51 means the caller must report
 * `truncated`. Documents without `createdAt` are not returned by the ordered query (Firestore `orderBy`).
 */
export interface RoleListWindow {
  docs: RawRoleDoc[];
  rawCount: number;
}

/** The only fields a field-level write may touch. `createdAt`, `createdBy` and the document id never change (AD-1). */
export type MutableRoleField = "name" | "description" | "expectations" | "updatedAt" | "updatedBy" | "archivedAt" | "archivedBy";

export const MUTABLE_ROLE_FIELDS: ReadonlySet<string> = new Set<MutableRoleField>([
  "name",
  "description",
  "expectations",
  "updatedAt",
  "updatedBy",
  "archivedAt",
  "archivedBy",
]);

/** A field-level change. `set` writes values; `unset` removes optional fields (archive clears, empty description). */
export interface RoleFieldChanges {
  set: Partial<Record<MutableRoleField, unknown>>;
  unset: MutableRoleField[];
}

export interface RoleStore {
  /** Creates a new document with a generated id (never overwrites) and returns the id. */
  create(role: StoredRoleDefinition): Promise<string>;
  /** `orderBy("createdAt", "asc").limit(51)` window (BR-22, PG-5). */
  listWindow(): Promise<RoleListWindow>;
  /** Number of all role-definition documents, malformed and missing-`createdAt` included (BR-7). */
  count(): Promise<number>;
  /** Raw stored data, or `undefined` when absent. A read failure rejects; it is never reported as absence. */
  get(roleId: string): Promise<RawRoleData | undefined>;
  /** Applies a field-level change to an existing document. Rejects when the document is absent or a field is not mutable. */
  update(roleId: string, changes: RoleFieldChanges): Promise<void>;
}

/** A document id the store refuses to build a path from. Carries no id and no content. */
export class InvalidRoleStoreKeyError extends Error {
  constructor() {
    super("invalid role store key");
    this.name = "InvalidRoleStoreKeyError";
  }
}

const ROLE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** A path `roleId` is addressable only if it matches this and is not a Firestore-reserved `__x__` id (BR-27a precedent). */
export function isAddressableRoleId(value: unknown): value is string {
  return typeof value === "string" && ROLE_ID_PATTERN.test(value) && !/^__.*__$/.test(value);
}

export function assertRoleIdSegment(value: unknown): asserts value is string {
  if (!isAddressableRoleId(value)) {
    throw new InvalidRoleStoreKeyError();
  }
}

export function assertMutableRoleChanges(changes: RoleFieldChanges): void {
  const fields = [...Object.keys(changes.set), ...changes.unset];
  if (fields.some((field) => !MUTABLE_ROLE_FIELDS.has(field))) {
    throw new InvalidRoleStoreKeyError();
  }
}
