import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { isValidSkillTree, type SkillTreeRecord } from "../domain/skill-tree";
import { isValidSkillProgress, skillProgressDocId, type SkillProgressRecord } from "../domain/skill-progress";

const SKILL_TREES_COLLECTION = "skillTrees";
const SKILL_PROGRESS_COLLECTION = "skillProgress";

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface UpdateTeamSkillProgressDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The read/write seam for the deterministic `skillProgress/{teamId}__
 * {treeId}` document, satisfied in production by direct Firestore document
 * calls (keyed by `skillProgressDocId`) and by an in-memory fake in tests.
 * **This interface has no `teams`-status-reading seam at all** — updating an
 * existing record is never gated on team status (SPEC — Owner decision 5).
 */
export interface SkillProgressDocStore {
  get(docId: string): Promise<UpdateTeamSkillProgressDocSnapshot>;
  update(docId: string, data: Record<string, unknown>): Promise<void>;
}

function getDefaultSkillProgressDocStore(): SkillProgressDocStore {
  return {
    async get(docId) {
      const snapshot = await getFirestoreDb().collection(SKILL_PROGRESS_COLLECTION).doc(docId).get();
      return { exists: snapshot.exists, data: () => snapshot.data() };
    },
    async update(docId, data) {
      await getFirestoreDb().collection(SKILL_PROGRESS_COLLECTION).doc(docId).update(data);
    },
  };
}

/** Maps raw Firestore document data (Timestamp fields included) into the candidate shape `isValidSkillProgress` expects. */
function toCandidateSkillProgress(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  return {
    ...record,
    updatedAt: toDateOrUndefined(record.updatedAt),
  };
}

/**
 * The read-only seam for the referenced `skillTrees/{treeId}` document,
 * satisfied in production by a direct Firestore document read and by an
 * in-memory fake in tests. Mirrors `SkillTreeReader` in
 * `start-team-skill-tracking.ts` — this operation only needs the tree's own
 * `nodes` list, never writes to it.
 */
export interface SkillTreeReader {
  get(treeId: string): Promise<UpdateTeamSkillProgressDocSnapshot>;
}

function getDefaultSkillTreeReader(): SkillTreeReader {
  return {
    async get(treeId) {
      const snapshot = await getFirestoreDb().collection(SKILL_TREES_COLLECTION).doc(treeId).get();
      return { exists: snapshot.exists, data: () => snapshot.data() };
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
  // Left as-is (not a Date) so the corresponding `isValidDate` check fails
  // closed on it, rather than silently coercing an unexpected shape.
  return value;
}

export type UpdateTeamSkillProgressResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "not_tracked" | "tree_not_found" | "invalid_input" | "persistence_failed";
    };

export interface UpdateTeamSkillProgressDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  progress?: SkillProgressDocStore;
  treeReader?: SkillTreeReader;
}

/**
 * Sets a team's current stage for a tracked SkillTree (docs/features/
 * team-skill-tree/SPEC.md — BR-11 through BR-13, BR-17). Only an app admin
 * may call this successfully. `teamId`/`treeId` are always the caller's
 * trusted server/route scope, never a body-supplied value — only `nodeId`
 * is caller-provided, and it is always re-validated against a fresh
 * server-side read of the target tree's own `nodes` list before being
 * trusted (BR-17).
 *
 * **Deliberately performs no `teams/{teamId}` read of any kind** — updating
 * an already-existing SkillProgress record remains available regardless of
 * the owning team's `active`/`disabled` status (SPEC — Owner decision 5,
 * BR-16). This function's own dependency seam (`UpdateTeamSkillProgressDeps`)
 * has no team-status-reading field at all, making that omission structural,
 * not merely a code-path choice.
 *
 * Order, exactly as SPEC specifies: `requireAppAdmin` → fetch + runtime-
 * validate `skillProgress/{teamId}__{treeId}` (deterministic id via
 * `skillProgressDocId`) — missing, malformed, or persisted `teamId`/`treeId`
 * not matching the requested scope → `not_tracked` (fail closed; a
 * malformed/mismatched record is never normalized or rewritten) → fetch +
 * runtime-validate `skillTrees/{treeId}` — missing/malformed → `tree_not_found`
 * (defensive; unreachable in v1 since trees are never deleted) → confirm the
 * requested `nodeId` is present in the tree's own `nodes` list — otherwise
 * `invalid_input` (rejects both an unknown `nodeId` and one from another
 * tree) → `.update()` with `currentNodeId` set to the requested `nodeId` and
 * server-derived `updatedAt`/`updatedBy` — no forward-only constraint, so a
 * `nodeId` earlier in the sequence than the current value is accepted the
 * same way (BR-13).
 */
export async function updateTeamSkillProgress(
  idToken: string,
  teamId: string,
  treeId: string,
  nodeId: unknown,
  deps: UpdateTeamSkillProgressDeps = {},
): Promise<UpdateTeamSkillProgressResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const docId = skillProgressDocId(teamId, treeId);
  const progress = deps.progress ?? getDefaultSkillProgressDocStore();

  let progressSnapshot: UpdateTeamSkillProgressDocSnapshot;
  try {
    progressSnapshot = await progress.get(docId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const progressCandidate = toCandidateSkillProgress(
    progressSnapshot.exists ? progressSnapshot.data() : undefined,
  );
  if (!isValidSkillProgress(progressCandidate)) {
    return { ok: false, error: "not_tracked" };
  }
  const existingProgress: SkillProgressRecord = progressCandidate;

  if (existingProgress.teamId !== teamId || existingProgress.treeId !== treeId) {
    return { ok: false, error: "not_tracked" };
  }

  const treeReader = deps.treeReader ?? getDefaultSkillTreeReader();
  let treeSnapshot: UpdateTeamSkillProgressDocSnapshot;
  try {
    treeSnapshot = await treeReader.get(treeId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const treeCandidate = toCandidateSkillTree(treeSnapshot.exists ? treeSnapshot.data() : undefined);
  if (!isValidSkillTree(treeCandidate)) {
    return { ok: false, error: "tree_not_found" };
  }
  const tree: SkillTreeRecord = treeCandidate;

  if (typeof nodeId !== "string" || !tree.nodes.some((node) => node.nodeId === nodeId)) {
    return { ok: false, error: "invalid_input" };
  }

  const now = deps.now ?? new Date();
  try {
    await progress.update(docId, { currentNodeId: nodeId, updatedAt: now, updatedBy: admin.identity.uid });
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
