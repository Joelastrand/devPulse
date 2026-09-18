import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import type { SkillTreeRecord } from "../domain/skill-tree";
import { buildSkillNodes, validateSkillNodeLabels, validateSkillTreeName } from "../domain/skill-tree-input";

const SKILL_TREES_COLLECTION = "skillTrees";

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore `CollectionReference` (whose `.add()` assigns the opaque,
 * auto-generated document ID that becomes `treeId` — never client-supplied
 * or content-derived, docs/features/team-skill-tree/SPEC.md BR-7) and by an
 * in-memory fake in tests.
 */
export interface SkillTreesCollection {
  add(record: SkillTreeRecord): Promise<{ id: string }>;
}

function getDefaultCollection(): SkillTreesCollection {
  return getFirestoreDb().collection(SKILL_TREES_COLLECTION);
}

export type CreateSkillTreeResult =
  | { ok: true; treeId: string }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "invalid_input" | "persistence_failed";
    };

export interface CreateSkillTreeDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: SkillTreesCollection;
}

/**
 * Creates a new SkillTree (docs/features/team-skill-tree/SPEC.md — BR-1
 * through BR-3, BR-7). Only an app admin may call this successfully —
 * reuses `requireAppAdmin` unchanged.
 *
 * `name`/`nodeLabels` are validated with the shared TASK-001 validators
 * before any Firestore write; `buildSkillNodes` then assigns each node's
 * permanently-stable `nodeId`/`order` from the submitted label order
 * (BR-3) — the only place this feature ever derives node identity from
 * scratch (`updateSkillTree` never does; see `update-skill-tree.ts`).
 *
 * No `updatedAt`/`updatedBy` field is written at creation — absent, not
 * `null`, until a first cosmetic correction (SPEC — "Data model").
 */
export async function createSkillTree(
  idToken: string,
  name: unknown,
  nodeLabels: unknown,
  deps: CreateSkillTreeDeps = {},
): Promise<CreateSkillTreeResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const nameResult = validateSkillTreeName(name);
  if (!nameResult.ok) {
    return { ok: false, error: "invalid_input" };
  }

  const labelsResult = validateSkillNodeLabels(nodeLabels);
  if (!labelsResult.ok) {
    return { ok: false, error: "invalid_input" };
  }

  const record: SkillTreeRecord = {
    name: nameResult.name,
    nodes: buildSkillNodes(labelsResult.labels),
    createdAt: deps.now ?? new Date(),
    createdBy: admin.identity.uid,
  };

  const collection = deps.collection ?? getDefaultCollection();

  try {
    const { id } = await collection.add(record);
    return { ok: true, treeId: id };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
