import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { isValidSkillTree, type SkillTreeRecord } from "../domain/skill-tree";
import { validateSkillNodeLabels, validateSkillTreeName } from "../domain/skill-tree-input";

const SKILL_TREES_COLLECTION = "skillTrees";

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface UpdateSkillTreeDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The read/write seam for the target `skillTrees/{treeId}` document itself,
 * satisfied in production by direct Firestore document calls and by an
 * in-memory fake in tests (mirrors `resolve-challenge.ts`'s
 * `ChallengeDocStore` — one seam per operation).
 */
export interface SkillTreeDocStore {
  get(treeId: string): Promise<UpdateSkillTreeDocSnapshot>;
  update(treeId: string, data: Record<string, unknown>): Promise<void>;
}

function getDefaultSkillTreeDocStore(): SkillTreeDocStore {
  return {
    async get(treeId) {
      const snapshot = await getFirestoreDb().collection(SKILL_TREES_COLLECTION).doc(treeId).get();
      return { exists: snapshot.exists, data: () => snapshot.data() };
    },
    async update(treeId, data) {
      await getFirestoreDb().collection(SKILL_TREES_COLLECTION).doc(treeId).update(data);
    },
  };
}

/** Maps raw Firestore document data (Timestamp fields included) into the candidate shape `isValidSkillTree` expects. */
function toCandidateSkillTree(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  return {
    ...record,
    createdAt: toDateOrUndefined(record.createdAt),
    updatedAt: toDateOrUndefined(record.updatedAt),
  };
}

function toDateOrUndefined(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  // Left as-is (not a Date) so `isValidSkillTree`'s `isValidDate` check
  // fails closed on it, rather than silently coercing an unexpected shape.
  return value;
}

export type UpdateSkillTreeResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "forbidden"
        | "tree_not_found"
        | "invalid_input"
        | "node_count_mismatch"
        | "persistence_failed";
    };

export interface UpdateSkillTreeDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  docs?: SkillTreeDocStore;
}

/**
 * Cosmetically corrects an existing SkillTree's `name` and/or its nodes'
 * `label` text — never its node count, order, or `nodeId`s (docs/features/
 * team-skill-tree/SPEC.md — "Cosmetic tree correction", BR-31, BR-32,
 * BR-35). Only an app admin may call this successfully.
 *
 * Request-level conceptual input is only `{name, nodeLabels}` — `nodeLabels`
 * is a plain `string[]`, never an array of node objects, so this function's
 * own signature has no parameter capable of expressing a `nodeId`, an
 * insertion, a removal, or a reorder in the first place. Every accepted
 * correction copies each existing node's `nodeId`/`order` unchanged from the
 * already-fetched record via strict positional replacement
 * (`existingTree.nodes.map((node, i) => ({...node, label: nodeLabels[i]}))`)
 * — `buildSkillNodes` (used only by `create-skill-tree.ts`) is never called
 * here.
 *
 * Order, exactly as SPEC specifies: `requireAppAdmin` → fetch + runtime-
 * validate the existing tree (`tree_not_found` on missing/malformed,
 * before any input validation) → validate `name`/`nodeLabels` format with
 * the same validators creation uses (`invalid_input`) → require
 * `nodeLabels.length === existingTree.nodes.length` exactly
 * (`node_count_mismatch`, nothing written) → positional-replace labels only
 * → `.update()` with `updatedAt`/`updatedBy` set — `createdAt`/`createdBy`
 * are never touched by this operation.
 */
export async function updateSkillTree(
  idToken: string,
  treeId: string,
  name: unknown,
  nodeLabels: unknown,
  deps: UpdateSkillTreeDeps = {},
): Promise<UpdateSkillTreeResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const docs = deps.docs ?? getDefaultSkillTreeDocStore();

  let snapshot: UpdateSkillTreeDocSnapshot;
  try {
    snapshot = await docs.get(treeId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const candidate = toCandidateSkillTree(snapshot.exists ? snapshot.data() : undefined);
  if (!isValidSkillTree(candidate)) {
    return { ok: false, error: "tree_not_found" };
  }
  const existingTree: SkillTreeRecord = candidate;

  const nameResult = validateSkillTreeName(name);
  if (!nameResult.ok) {
    return { ok: false, error: "invalid_input" };
  }

  const labelsResult = validateSkillNodeLabels(nodeLabels);
  if (!labelsResult.ok) {
    return { ok: false, error: "invalid_input" };
  }

  if (labelsResult.labels.length !== existingTree.nodes.length) {
    return { ok: false, error: "node_count_mismatch" };
  }

  const nodes = existingTree.nodes.map((node, index) => ({
    ...node,
    label: labelsResult.labels[index],
  }));

  const now = deps.now ?? new Date();
  try {
    await docs.update(treeId, {
      name: nameResult.name,
      nodes,
      updatedAt: now,
      updatedBy: admin.identity.uid,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
