import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { isValidSkillTree } from "../../skill-trees/domain/skill-tree";
import { sortSkillRows } from "../domain/skill-profile-view";

const SKILL_TREES_COLLECTION = "skillTrees";

/** Size of the visible candidate window of raw `skillTrees` documents (SPEC BR-11). */
export const SKILL_CATALOG_WINDOW = 500;

/** One raw `skillTrees` document with its Firestore id. */
export interface RawCatalogDoc {
  id: string;
  data: unknown;
}

/**
 * Read seam for the catalog. Returns every raw document the bounded, ordered
 * query yields, valid or not; validation happens in `readSkillCatalog`.
 */
export interface SkillCatalogReader {
  listOrderedByCreatedAt(limit: number): Promise<RawCatalogDoc[]>;
}

export function getDefaultSkillCatalogReader(): SkillCatalogReader {
  return {
    async listOrderedByCreatedAt(limit) {
      const snapshot = await getFirestoreDb()
        .collection(SKILL_TREES_COLLECTION)
        .orderBy("createdAt", "asc")
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
  };
}

/**
 * Deliberately duplicated from `listSkillTrees` (which stays untouched); a
 * parity test keeps the two interpretations identical.
 */
export function toCandidateSkillTree(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  return {
    ...record,
    createdAt: toDateOrUndefined(record.createdAt),
    updatedAt: toDateOrUndefined(record.updatedAt),
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

export interface SkillCatalog {
  skills: Array<{ treeId: string; name: string }>;
  truncated: boolean;
}

/**
 * Raw-window catalog read (SPEC BR-11). One query, `limit(501)`: the first 500
 * raw documents are the candidate window, a 501st is only a truncation probe.
 * Invalid window documents are dropped and keep their slot (no refill).
 * Presentation sorting happens last and never affects window membership.
 */
export async function readSkillCatalog(reader: SkillCatalogReader): Promise<SkillCatalog> {
  const raw = await reader.listOrderedByCreatedAt(SKILL_CATALOG_WINDOW + 1);
  const skills: SkillCatalog["skills"] = [];
  for (const { id, data } of raw.slice(0, SKILL_CATALOG_WINDOW)) {
    const candidate = toCandidateSkillTree(data);
    if (isValidSkillTree(candidate)) skills.push({ treeId: id, name: candidate.name });
  }
  return { skills: sortSkillRows(skills), truncated: raw.length > SKILL_CATALOG_WINDOW };
}
