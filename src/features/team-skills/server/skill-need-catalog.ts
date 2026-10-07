import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { sortSkillRows } from "../../skill-profiles/domain/skill-profile-view";
import { isValidSkillTree, type SkillTreeRecord } from "../../skill-trees/domain/skill-tree";

const SKILL_TREES_COLLECTION = "skillTrees";

/** Candidate window of raw `skillTrees` documents; same policy as the C1 catalog (SPEC BR-4 → C1 BR-11). */
export const SKILL_NEED_CATALOG_WINDOW = 500;

export interface RawTreeDoc {
  id: string;
  data: unknown;
}

/** Read seam for the member-readable catalog and direct tree lookups. No write method exists. */
export interface SkillNeedCatalogReader {
  listOrderedByCreatedAt(limit: number): Promise<RawTreeDoc[]>;
  /** Raw `skillTrees/{treeId}` data, or `undefined` if absent. */
  getSkillTree(treeId: string): Promise<unknown>;
}

export function getDefaultSkillNeedCatalogReader(): SkillNeedCatalogReader {
  return {
    async listOrderedByCreatedAt(limit) {
      const snapshot = await getFirestoreDb()
        .collection(SKILL_TREES_COLLECTION)
        .orderBy("createdAt", "asc")
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    async getSkillTree(treeId) {
      const snapshot = await getFirestoreDb().collection(SKILL_TREES_COLLECTION).doc(treeId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

function toDateOrUndefined(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  // Left as-is so `isValidSkillTree` fails closed on an unexpected shape.
  return value;
}

/** Minimal duplicate of the `listSkillTrees` candidate mapping; a parity test pins the two together. */
export function toCandidateSkillTree(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  return {
    ...record,
    createdAt: toDateOrUndefined(record.createdAt),
    updatedAt: toDateOrUndefined(record.updatedAt),
  };
}

/** A valid tree for a direct lookup, or `null` when missing or invalid. Read failures reject. */
export async function readValidSkillTree(
  reader: SkillNeedCatalogReader,
  treeId: string,
): Promise<SkillTreeRecord | null> {
  const candidate = toCandidateSkillTree(await reader.getSkillTree(treeId));
  return isValidSkillTree(candidate) ? candidate : null;
}

export interface SkillNeedCatalog {
  catalog: Array<{ treeId: string; name: string }>;
  truncated: boolean;
}

/**
 * Raw-window read: one query with `limit(501)`; the first 500 raw documents are
 * the window, a 501st is only the truncation probe. Invalid window documents are
 * dropped and keep their slot (no refill). Name sorting happens last and never
 * changes window membership.
 */
export async function readSkillNeedCatalog(reader: SkillNeedCatalogReader): Promise<SkillNeedCatalog> {
  const raw = await reader.listOrderedByCreatedAt(SKILL_NEED_CATALOG_WINDOW + 1);
  const rows: SkillNeedCatalog["catalog"] = [];
  for (const { id, data } of raw.slice(0, SKILL_NEED_CATALOG_WINDOW)) {
    const candidate = toCandidateSkillTree(data);
    if (isValidSkillTree(candidate)) rows.push({ treeId: id, name: candidate.name });
  }
  return { catalog: sortSkillRows(rows), truncated: raw.length > SKILL_NEED_CATALOG_WINDOW };
}
