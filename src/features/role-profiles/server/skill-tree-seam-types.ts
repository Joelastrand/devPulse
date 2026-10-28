import { isValidSkillTree } from "../../skill-trees/domain/skill-tree";

/**
 * Read-only SkillTree seam for role expectations (TASK-006; AD-4, BR-2, BR-8, BR-11, BR-22). Pure types and the
 * classification of referenced `treeId`s, shared by the Firestore readers and tests. Imports nothing from
 * Firebase and nothing from the SkillTree server module.
 */

/** Maximum document refs per batch read (repository precedent: D1 catalog and C1 profile batch reads). */
export const SKILL_TREE_READ_CHUNK_SIZE = 100;

/** One raw `skillTrees` read. `data` is `undefined` when the document does not exist. */
export interface RawSkillTreeRead {
  id: string;
  data: unknown;
}

/**
 * Batch read over `skillTrees`. Read-only: no write and no batch write. A rejected promise is a read failure
 * and must never be reported as a missing tree.
 */
export interface RawSkillTreeReader {
  /** At most {@link SKILL_TREE_READ_CHUNK_SIZE} ids per call; one result per requested id. */
  getMany(treeIds: readonly string[]): Promise<RawSkillTreeRead[]>;
}

/** Per-`treeId` classification. The name is present only for a valid tree (BR-22: names only for referenced ids). */
export type SkillTreeReference =
  | { status: "valid"; treeId: string; name: string }
  | { status: "missing"; treeId: string }
  | { status: "invalid"; treeId: string };

function classify(treeId: string, read: RawSkillTreeRead | undefined): SkillTreeReference {
  if (read === undefined || read.data === undefined) {
    return { status: "missing", treeId };
  }
  if (!isValidSkillTree(read.data)) {
    return { status: "invalid", treeId };
  }
  return { status: "valid", treeId, name: read.data.name };
}

/**
 * Classifies each distinct referenced `treeId` (only referenced ids are read). Reads run in chunks of 100. A
 * rejected chunk read rejects this function; nothing is classified from a failed read.
 */
export async function resolveSkillTreeReferences(
  treeIds: readonly string[],
  reader: RawSkillTreeReader,
): Promise<Map<string, SkillTreeReference>> {
  const distinct = [...new Set(treeIds)];
  const references = new Map<string, SkillTreeReference>();
  for (let start = 0; start < distinct.length; start += SKILL_TREE_READ_CHUNK_SIZE) {
    const chunk = distinct.slice(start, start + SKILL_TREE_READ_CHUNK_SIZE);
    const reads = await reader.getMany(chunk);
    const byId = new Map(reads.map((read) => [read.id, read]));
    for (const treeId of chunk) {
      references.set(treeId, classify(treeId, byId.get(treeId)));
    }
  }
  return references;
}
