import type { StoredRoleDefinition } from "../domain/role-definition";
import {
  assertMutableRoleChanges,
  assertRoleIdSegment,
  ROLE_RAW_READ_LIMIT,
  type RawRoleData,
  type RoleFieldChanges,
  type RoleListWindow,
  type RoleStore,
} from "./role-store-types";
import { ROLE_LIST_WINDOW } from "../domain/role-definition";

/**
 * In-memory {@link RoleStore} for tests only; production modules must not import it (role scope guard).
 * Stored `Date` values stand for Firestore `Timestamp`s. It models what the operations rely on: documents
 * without `createdAt` are excluded from the ordered read but still counted, the ordered read is bounded to 51
 * raw documents, ties break by document id, and `createdAt` is never rewritten. It is not an emulator.
 */

type Doc = Record<string, unknown>;

// Firestore cross-type order for the values that can appear in `createdAt` here: number < timestamp < string.
function typeRank(value: unknown): number {
  if (typeof value === "number") return 0;
  if (value instanceof Date) return 1;
  if (typeof value === "string") return 2;
  return 3;
}

function compareCreatedAt(a: unknown, b: unknown): number {
  const byType = typeRank(a) - typeRank(b);
  if (byType !== 0) return byType;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export function createFakeRoleStore(options: { generateId?: () => string } = {}): RoleStore & {
  /** Test-only: writes a raw document as-is, so malformed shapes can be exercised. */
  seedRaw(id: string, data: Doc): void;
} {
  const docs = new Map<string, Doc>();
  let nextId = 0;

  return {
    seedRaw(id, data) {
      docs.set(id, copy(data));
    },

    async create(role: StoredRoleDefinition) {
      const id = options.generateId?.() ?? `fake-role-${(nextId += 1)}`;
      assertRoleIdSegment(id);
      if (docs.has(id)) {
        throw new Error("role document already exists");
      }
      docs.set(id, copy({ ...role }));
      return id;
    },

    async listWindow(): Promise<RoleListWindow> {
      const ordered = [...docs.entries()]
        .filter(([, data]) => data.createdAt !== undefined)
        .sort(([idA, a], [idB, b]) => compareCreatedAt(a.createdAt, b.createdAt) || (idA < idB ? -1 : idA > idB ? 1 : 0))
        .slice(0, ROLE_RAW_READ_LIMIT);
      return {
        docs: ordered.slice(0, ROLE_LIST_WINDOW).map(([id, data]) => ({ id, data: copy(data) })),
        rawCount: ordered.length,
      };
    },

    async count() {
      return docs.size;
    },

    async get(roleId: string): Promise<RawRoleData | undefined> {
      assertRoleIdSegment(roleId);
      const data = docs.get(roleId);
      return data === undefined ? undefined : copy(data);
    },

    async update(roleId: string, changes: RoleFieldChanges) {
      assertRoleIdSegment(roleId);
      assertMutableRoleChanges(changes);
      const existing = docs.get(roleId);
      if (existing === undefined) {
        throw new Error("role document not found");
      }
      const next: Doc = copy(existing);
      for (const [field, value] of Object.entries(changes.set)) {
        next[field] = copy(value);
      }
      for (const field of changes.unset) {
        delete next[field];
      }
      docs.set(roleId, next);
    },
  };
}
