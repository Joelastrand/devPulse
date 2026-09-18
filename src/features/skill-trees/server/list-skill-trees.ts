import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { isValidSkillTree, type SkillTreeRecord } from "../domain/skill-tree";

const SKILL_TREES_COLLECTION = "skillTrees";

/**
 * The server-enforced bound on `listSkillTrees` (docs/features/
 * team-skill-tree/SPEC.md — "Firestore query/index requirements", BR-6). If
 * more than this many `skillTrees` documents exist, this operation returns
 * exactly the oldest-created ones and silently omits the rest — never
 * accompanied by a total count or any signal implying the response is
 * exhaustive.
 */
export const LIST_SKILL_TREES_LIMIT = 500;

/** The client-facing shape of one node within a listed SkillTree — never `createdAt`/`createdBy`/`updatedAt`/`updatedBy`. */
export interface SkillNodeView {
  nodeId: string;
  label: string;
  order: number;
}

/** The client-facing shape of one listed SkillTree (docs/features/team-skill-tree/SPEC.md — "API/DTO contracts"). */
export interface SkillTreeView {
  treeId: string;
  name: string;
  nodes: SkillNodeView[];
}

/** One raw `skillTrees` document, paired with its Firestore-assigned id (never itself part of the stored fields). */
export interface RawSkillTreeDoc {
  id: string;
  data: unknown;
}

/**
 * The read seam this operation depends on, satisfied in production by a
 * Firestore query and by an in-memory fake in tests. Returns every raw
 * document the bounded, ordered query yields regardless of validity —
 * filtering/validation happens entirely in `listSkillTrees`, never here.
 */
export interface SkillTreesReader {
  listOrderedByCreatedAt(limit: number): Promise<RawSkillTreeDoc[]>;
}

function getDefaultSkillTreesReader(): SkillTreesReader {
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

function toSkillTreeView(treeId: string, tree: SkillTreeRecord): SkillTreeView {
  return {
    treeId,
    name: tree.name,
    nodes: tree.nodes.map((node) => ({ nodeId: node.nodeId, label: node.label, order: node.order })),
  };
}

export type ListSkillTreesResult =
  | { ok: true; trees: SkillTreeView[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface ListSkillTreesDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  reader?: SkillTreesReader;
}

/**
 * Lists the SkillTree catalog, bounded to the `LIST_SKILL_TREES_LIMIT`
 * oldest-created (docs/features/team-skill-tree/SPEC.md — BR-6). Only an
 * app admin may call this successfully — no member-facing tree catalog
 * exists in v1.
 *
 * `.orderBy("createdAt", "asc").limit(LIST_SKILL_TREES_LIMIT)`, no
 * `.where()` — a single-field, auto-indexed query (SPEC — "Firestore
 * query/index requirements", BR-25); no composite index is required.
 *
 * Every item is rebuilt into `SkillTreeView` explicitly from only
 * `treeId`/`name`/`nodes` — `createdAt`/`createdBy`/`updatedAt`/`updatedBy`
 * never reach the returned shape. A malformed document is excluded
 * (fail-closed) rather than crashing or being silently normalized.
 */
export async function listSkillTrees(
  idToken: string,
  deps: ListSkillTreesDeps = {},
): Promise<ListSkillTreesResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const reader = deps.reader ?? getDefaultSkillTreesReader();

  let rawDocs: RawSkillTreeDoc[];
  try {
    rawDocs = await reader.listOrderedByCreatedAt(LIST_SKILL_TREES_LIMIT);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const trees: SkillTreeView[] = [];
  for (const { id, data } of rawDocs) {
    const candidate = toCandidateSkillTree(data);
    if (isValidSkillTree(candidate)) {
      trees.push(toSkillTreeView(id, candidate));
    }
  }

  return { ok: true, trees };
}
