import type { RawRoleData } from "./role-store-types";
import type { RawSkillTreeReader } from "./skill-tree-seam-types";
import { assertSubjectUidSegment, type RoleTargetStore, type RoleTargetWrite } from "./role-target-store-types";

export interface FakeRoleTargetStoreOptions {
  /** Non-transactional role source for the selection scope; absent roles read as missing. */
  readRole?: (roleId: string) => Promise<RawRoleData | undefined>;
  /** SkillTree source for the selection scope; absent trees read as missing. */
  trees?: RawSkillTreeReader;
}

/**
 * In-memory {@link RoleTargetStore} for tests only; production modules must not import it (role-profiles scope guard).
 * `log` records every call in order (`get:`, `delete:`, `tx.get:`, `tx.set:`), so tests can prove that a read or a
 * refusal performs no write. Like Firestore, a read after the selection write is rejected. It is not an emulator.
 */
export function createFakeRoleTargetStore(options: FakeRoleTargetStoreOptions = {}): RoleTargetStore & {
  /** Test-only: writes raw content as-is, so malformed shapes can be exercised. */
  seedRaw(subjectUid: string, data: RawRoleData): void;
  /** Test-only: every subject uid that currently has a stored target. */
  storedSubjectUids(): string[];
  /** Test-only: the stored raw target for one subject, or `undefined`. */
  storedTarget(subjectUid: string): RawRoleData | undefined;
  /** Test-only: call log in order. */
  log: string[];
} {
  const docs = new Map<string, RawRoleData>();
  const log: string[] = [];
  const readRole = options.readRole ?? (async () => undefined);
  const trees: RawSkillTreeReader = options.trees ?? {
    async getMany(treeIds) {
      return treeIds.map((id) => ({ id, data: undefined }));
    },
  };

  return {
    log,

    seedRaw(subjectUid, data) {
      docs.set(subjectUid, structuredClone(data));
    },

    storedSubjectUids() {
      return [...docs.keys()].sort();
    },

    storedTarget(subjectUid) {
      const data = docs.get(subjectUid);
      return data === undefined ? undefined : structuredClone(data);
    },

    async get(subjectUid) {
      assertSubjectUidSegment(subjectUid);
      log.push(`get:${subjectUid}`);
      const data = docs.get(subjectUid);
      return data === undefined ? undefined : structuredClone(data);
    },

    async delete(subjectUid) {
      assertSubjectUidSegment(subjectUid);
      log.push(`delete:${subjectUid}`);
      docs.delete(subjectUid);
    },

    async runSelection(subjectUid, work) {
      assertSubjectUidSegment(subjectUid);
      let written = false;
      return work({
        async readRole(roleId) {
          if (written) throw new Error("role read after the selection write");
          log.push(`tx.get:role:${roleId}`);
          return readRole(roleId);
        },
        trees: {
          async getMany(treeIds) {
            if (written) throw new Error("SkillTree read after the selection write");
            log.push(`tx.get:trees:${treeIds.join(",")}`);
            return trees.getMany(treeIds);
          },
        },
        writeTarget(target: RoleTargetWrite) {
          written = true;
          log.push(`tx.set:${subjectUid}`);
          docs.set(subjectUid, structuredClone({ ...target }));
        },
      });
    },
  };
}
