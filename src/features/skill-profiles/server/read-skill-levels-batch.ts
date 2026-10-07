import "server-only";
import { readSkillProfileRecord, selectVisibleLevels } from "../domain/skill-profile";
import { readSkillProfilesBatch } from "./skill-profile-store";

/**
 * Bounds of one call. `MAX_UIDS` equals the team cohort scan bound owned by the
 * team-skills policy (a test pins the equality); it is repeated here only so this
 * feature does not import team-skills. `MAX_TREES` is the catalog window.
 */
export const SKILL_LEVELS_BATCH_MAX_UIDS = 500;
export const SKILL_LEVELS_BATCH_MAX_TREES = 500;

export interface ReadSkillLevelsBatchDeps {
  readRaw?: (uids: readonly string[]) => Promise<ReadonlyArray<Record<string, unknown> | undefined>>;
}

export type ReadSkillLevelsBatchResult = { ok: true; levelsByTree: Map<string, number[]> } | { ok: false };

/**
 * Identity-free personal levels for a caller-supplied set of people: for each
 * requested tree, the valid levels (1–4) as a plain integer array sorted
 * ascending. No uid, document, field or input order survives into the result.
 * Absent, unreadable and invalid entries are skipped silently and identically —
 * no counts, no reasons — and never become a level. Duplicate uids and tree ids
 * are collapsed, so a person is never counted twice. Eligibility of the people
 * is the caller's responsibility. Read-only; fails closed (`{ ok: false }`) on any
 * read failure or when an input exceeds its bound.
 */
export async function readSkillLevelsBatch(
  uids: readonly string[],
  treeIds: readonly string[],
  deps: ReadSkillLevelsBatchDeps = {},
): Promise<ReadSkillLevelsBatchResult> {
  const uniqueUids = [...new Set(uids)];
  const uniqueTreeIds = [...new Set(treeIds)];
  if (uniqueUids.length > SKILL_LEVELS_BATCH_MAX_UIDS || uniqueTreeIds.length > SKILL_LEVELS_BATCH_MAX_TREES) {
    return { ok: false };
  }

  const levelsByTree = new Map<string, number[]>(uniqueTreeIds.map((treeId) => [treeId, []]));
  if (uniqueUids.length === 0) return { ok: true, levelsByTree };

  let documents: ReadonlyArray<Record<string, unknown> | undefined>;
  try {
    documents = await (deps.readRaw ?? readSkillProfilesBatch)(uniqueUids);
  } catch {
    return { ok: false };
  }

  for (const document of documents) {
    const record = readSkillProfileRecord(document);
    if (!record.readable) continue;
    for (const [treeId, level] of selectVisibleLevels(uniqueTreeIds, record.levels)) {
      if (level !== null) levelsByTree.get(treeId)?.push(level);
    }
  }
  for (const values of levelsByTree.values()) values.sort((a, b) => a - b);
  return { ok: true, levelsByTree };
}
