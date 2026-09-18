import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessDeps,
} from "../../teams/server/authorize-team-access";
import { isValidSkillTree, type SkillTreeRecord } from "../domain/skill-tree";
import { isValidSkillProgress, type SkillProgressRecord } from "../domain/skill-progress";

const SKILL_PROGRESS_COLLECTION = "skillProgress";
const SKILL_TREES_COLLECTION = "skillTrees";

/** The client-facing shape of one node within a tracked tree — never `createdAt`/`createdBy`/`updatedAt`/`updatedBy`. */
export interface SkillNodeView {
  nodeId: string;
  label: string;
  order: number;
}

/**
 * The client-facing shape of one tree a team is tracking (docs/features/
 * team-skill-tree/SPEC.md — "API/DTO contracts"). Deliberately excludes
 * `createdAt`/`createdBy`/`updatedAt`/`updatedBy` from either the
 * `skillProgress` or `skillTrees` source document (BR-22) — this is a
 * team-level view only, never carrying any admin/member identity.
 */
export interface TeamSkillProgressView {
  treeId: string;
  name: string;
  nodes: SkillNodeView[];
  currentNodeId: string | null;
}

/** One raw `skillProgress` document, paired with its Firestore-assigned id (not itself part of the returned DTO). */
export interface RawSkillProgressDoc {
  id: string;
  data: unknown;
}

/**
 * The read seam for the `skillProgress` query this operation depends on,
 * satisfied in production by a Firestore query and by an in-memory fake in
 * tests. Returns every raw document the query yields regardless of
 * validity — filtering/validation happens entirely in `getTeamSkillProgress`,
 * never here (mirrors `list-team-challenges.ts`'s `ChallengesReader` seam).
 */
export interface SkillProgressReader {
  listRawForTeam(teamId: string): Promise<RawSkillProgressDoc[]>;
}

function getDefaultSkillProgressReader(): SkillProgressReader {
  return {
    async listRawForTeam(teamId) {
      const snapshot = await getFirestoreDb()
        .collection(SKILL_PROGRESS_COLLECTION)
        .where("teamId", "==", teamId)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
  };
}

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface GetTeamSkillProgressDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The read-only seam for a referenced `skillTrees/{treeId}` document,
 * satisfied in production by a direct Firestore document read and by an
 * in-memory fake in tests.
 */
export interface SkillTreeReader {
  get(treeId: string): Promise<GetTeamSkillProgressDocSnapshot>;
}

function getDefaultSkillTreeReader(): SkillTreeReader {
  return {
    async get(treeId) {
      const snapshot = await getFirestoreDb().collection(SKILL_TREES_COLLECTION).doc(treeId).get();
      return { exists: snapshot.exists, data: () => snapshot.data() };
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

export type GetTeamSkillProgressResult =
  | { ok: true; skills: TeamSkillProgressView[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface GetTeamSkillProgressDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  authCollection?: AuthorizeTeamAccessDeps["collection"];
  progressReader?: SkillProgressReader;
  treeReader?: SkillTreeReader;
}

/**
 * Reads a team's full skill-tracking state (docs/features/team-skill-tree/
 * SPEC.md — BR-18 through BR-23). Requires `authorizeTeamAccess` to resolve
 * to `"admin"` or `"member"` for `teamId` — the same broader viewing
 * boundary `listTeamChallengesForMember`/`getCurrentTeamSurvey` already use,
 * deliberately **not** `requireAppAdmin` (this is a read, not one of
 * TASK-002/TASK-003's admin-only writes). `"denied"` is rejected
 * `forbidden`; a `read_failed` from the authorization check itself is never
 * collapsed into `forbidden`.
 *
 * **No `teams/{teamId}.status` gate of any kind** — a disabled team's
 * existing skill progress remains readable (BR-21), exactly like viewing
 * always has been for every other team-scoped read in this codebase.
 *
 * Query: `skillProgress` where `teamId == teamId` — a single-field equality
 * filter, auto-indexed, no composite index required (BR-25). Per result:
 * `isValidSkillProgress` (TASK-001, fail-closed, skip on failure) → a
 * defense-in-depth cross-check that the record's own persisted `teamId`
 * matches the requested scope (mirrors `fetchTeamChallenges`'s identical
 * cross-check — query scoping is never trusted as the only protection) →
 * fetch `skillTrees/{treeId}` by direct `get` → `isValidSkillTree`
 * (fail-closed, skip on failure) → map to `TeamSkillProgressView`
 * (`treeId`, `name`, `nodes`, `currentNodeId`) — never `createdAt`/
 * `createdBy`/`updatedAt`/`updatedBy` from either source document (BR-22),
 * rebuilt explicitly field-by-field, never a spread of raw data.
 *
 * A malformed `skillProgress` record, a cross-scope-mismatched one, or one
 * whose `treeId` no longer resolves to a valid `skillTrees` document is
 * excluded from the response rather than failing the whole call (BR-23). A
 * thrown/rejected read — either the `skillProgress` query itself or an
 * individual `skillTrees` fetch — fails the whole call closed with
 * `read_failed`, distinct from the excluded-record cases above and from
 * `authorizeTeamAccess`'s own `read_failed` path (never any partial/raw
 * data on that failure).
 *
 * No ordering requirement (SPEC/TASKS.md — "No ordering requirement on the
 * returned array"); the result reflects the query's own document order.
 */
export async function getTeamSkillProgress(
  idToken: string,
  teamId: string,
  deps: GetTeamSkillProgressDeps = {},
): Promise<GetTeamSkillProgressResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  const authResult = await authorizeTeamAccess(verified.identity, teamId, {
    allowList: deps.allowList,
    collection: deps.authCollection,
  });
  if (!authResult.ok) {
    return { ok: false, error: "read_failed" };
  }
  if (authResult.access === "denied") {
    return { ok: false, error: "forbidden" };
  }

  const progressReader = deps.progressReader ?? getDefaultSkillProgressReader();
  let rawDocs: RawSkillProgressDoc[];
  try {
    rawDocs = await progressReader.listRawForTeam(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const treeReader = deps.treeReader ?? getDefaultSkillTreeReader();
  const skills: TeamSkillProgressView[] = [];

  for (const { data } of rawDocs) {
    const progressCandidate = toCandidateSkillProgress(data);
    if (!isValidSkillProgress(progressCandidate)) {
      continue;
    }
    const progress: SkillProgressRecord = progressCandidate;

    if (progress.teamId !== teamId) {
      continue;
    }

    let treeSnapshot: GetTeamSkillProgressDocSnapshot;
    try {
      treeSnapshot = await treeReader.get(progress.treeId);
    } catch {
      return { ok: false, error: "read_failed" };
    }

    const treeCandidate = toCandidateSkillTree(treeSnapshot.exists ? treeSnapshot.data() : undefined);
    if (!isValidSkillTree(treeCandidate)) {
      continue;
    }
    const tree: SkillTreeRecord = treeCandidate;

    skills.push({
      treeId: progress.treeId,
      name: tree.name,
      nodes: tree.nodes.map((node) => ({ nodeId: node.nodeId, label: node.label, order: node.order })),
      currentNodeId: progress.currentNodeId,
    });
  }

  return { ok: true, skills };
}
