import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import { isValidSkillTree, type SkillTreeRecord } from "../domain/skill-tree";
import { isValidSkillProgress, skillProgressDocId, type SkillProgressRecord } from "../domain/skill-progress";

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const SKILL_TREES_COLLECTION = "skillTrees";
const SKILL_PROGRESS_COLLECTION = "skillProgress";

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface ReportTeamSkillProgressDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The read seam for a real `teamMemberships/{uid}__{teamId}` record — same
 * shape as `submitChallenge`/`createThread`/`createReply`'s (BR-1, BR-7).
 * Returns raw, unvalidated data; `reportTeamSkillProgress` is responsible for
 * validating it (via `isValidMembershipFor`) before trusting it.
 */
export interface MembershipReader {
  getMembership(uid: string, teamId: string): Promise<unknown>;
}

function getDefaultMembershipReader(): MembershipReader {
  return {
    async getMembership(uid, teamId) {
      const snapshot = await getFirestoreDb()
        .collection(MEMBERSHIPS_COLLECTION)
        .doc(membershipDocId(uid, teamId))
        .get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

/**
 * The read seam for the owning team's fresh `status` — same shape as
 * `submitChallenge`/`createThread`/`createReply`'s `TeamStatusReader`
 * (revised BR-4).
 */
export interface TeamStatusReader {
  getTeamStatus(teamId: string): Promise<unknown>;
}

function getDefaultTeamStatusReader(): TeamStatusReader {
  return {
    async getTeamStatus(teamId) {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
  };
}

/**
 * The read/write seam for the deterministic `skillProgress/{teamId}__
 * {treeId}` document — same shape as `updateTeamSkillProgress`'s
 * `SkillProgressDocStore`. Unlike that operation's dependency shape, this
 * operation's own `*Deps` interface also carries a `teams`-status-reading
 * seam (`TeamStatusReader`, above) — the one structural difference between
 * the two operations' dependency shapes (revised BR-4).
 */
export interface SkillProgressDocStore {
  get(docId: string): Promise<ReportTeamSkillProgressDocSnapshot>;
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
 * The read-only seam for the referenced `skillTrees/{treeId}` document —
 * same shape as `updateTeamSkillProgress`'s `SkillTreeReader`. This operation
 * only needs the tree's own `nodes` list, never writes to it.
 */
export interface SkillTreeReader {
  get(treeId: string): Promise<ReportTeamSkillProgressDocSnapshot>;
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

export type ReportTeamSkillProgressResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "forbidden"
        | "team_disabled"
        | "not_tracked"
        | "tree_not_found"
        | "invalid_input"
        | "persistence_failed";
    };

export interface ReportTeamSkillProgressDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  membershipReader?: MembershipReader;
  teamStatusReader?: TeamStatusReader;
  progress?: SkillProgressDocStore;
  treeReader?: SkillTreeReader;
}

/**
 * Sets a team's current stage for a tree the team already tracks, on behalf
 * of a genuine team member (docs/features/skill-progress-self-report/
 * SPEC.md — BR-1 through BR-7, BR-9). This is a **second, additive** write
 * path for `skillProgress.currentNodeId`, distinct from the app-admin-only
 * `updateTeamSkillProgress` — kept as a separate operation/file so each
 * one's authorization boundary stays singular (SPEC "Architecture
 * decisions"). `updateTeamSkillProgress` is never called or reused here, and
 * this function performs **no app-admin check of any kind**: admin status
 * neither grants nor is required for this operation (BR-1). `teamId`/
 * `treeId` are always the caller's trusted route scope; only `nodeId` is
 * caller-provided, and it is always re-validated against a fresh
 * server-side read of the target tree's own `nodes` list before being
 * trusted (BR-6).
 *
 * Order, exactly as SPEC specifies, fail-closed with zero writes before the
 * final step: `verifyIdToken` (`unauthenticated`) → fresh-read
 * `teamMemberships/{uid}__{teamId}`, validated via `isValidMembershipFor`
 * (reused unchanged from `src/features/teams/domain/team-membership.ts`,
 * the same primitive `submitChallenge`/`createThread`/`createReply` already
 * use) — missing/malformed/wrong-scope → `forbidden` (BR-1, BR-7) → fresh-
 * read `teams/{teamId}.status`, validated via `isValidTeamStatus` (reused
 * unchanged from `src/features/teams/domain/team.ts`) — anything other than
 * `"active"`, including a missing or malformed team → `team_disabled`
 * (revised BR-4; this operation's error contract has no separate
 * `team_not_found`, mirroring `createReply`'s identical single-outcome
 * folding, not `createThread`/`submitChallenge`'s two-outcome split) →
 * fetch `skillProgress/{teamId}__{treeId}` (deterministic id via
 * `skillProgressDocId`), validated via `isValidSkillProgress` and
 * cross-checked against the requested scope — missing, malformed, or
 * persisted `teamId`/`treeId` not matching the requested scope → `not_tracked`,
 * never normalized or rewritten (BR-3) → fetch `skillTrees/{treeId}`,
 * validated via `isValidSkillTree` — missing or malformed → `tree_not_found`
 * (defensive; unreachable in practice since trees are never deleted or
 * structurally corrupted) → confirm `nodeId` is present in the tree's own
 * `nodes` list — otherwise `invalid_input` (BR-6) → `.update()` with exactly
 * `{currentNodeId, updatedAt, updatedBy}` — always performed, including when
 * `nodeId` equals the record's current value (no same-node short-circuit;
 * SPEC "Concurrency/idempotency behavior").
 *
 * `updatedBy` is always the verified caller's own `uid` (BR-5) — never
 * client-supplied, and never returned by any API response
 * (`getTeamSkillProgress`'s DTO is unaffected, BR-9). Fails closed on any
 * Firestore error at any step → `persistence_failed`.
 */
export async function reportTeamSkillProgress(
  idToken: string,
  teamId: string,
  treeId: string,
  nodeId: unknown,
  deps: ReportTeamSkillProgressDeps = {},
): Promise<ReportTeamSkillProgressResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  const membershipReader = deps.membershipReader ?? getDefaultMembershipReader();
  let rawMembership: unknown;
  try {
    rawMembership = await membershipReader.getMembership(verified.identity.uid, teamId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const isMember = isValidMembershipFor(rawMembership, { uid: verified.identity.uid, teamId });
  if (!isMember) {
    return { ok: false, error: "forbidden" };
  }

  const teamStatusReader = deps.teamStatusReader ?? getDefaultTeamStatusReader();
  let rawTeamStatus: unknown;
  try {
    rawTeamStatus = await teamStatusReader.getTeamStatus(teamId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  if (!isValidTeamStatus(rawTeamStatus) || rawTeamStatus !== "active") {
    // Covers "disabled", "nonexistent" (Firestore returns `undefined`), and
    // any other malformed/unrecognized status uniformly (revised BR-4) —
    // this operation's documented API/DTO contract has no distinct
    // `team_not_found` outcome, mirroring `createReply`'s identical posture
    // for a member-originated write into an already-existing resource.
    return { ok: false, error: "team_disabled" };
  }

  const docId = skillProgressDocId(teamId, treeId);
  const progress = deps.progress ?? getDefaultSkillProgressDocStore();

  let progressSnapshot: ReportTeamSkillProgressDocSnapshot;
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
  let treeSnapshot: ReportTeamSkillProgressDocSnapshot;
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
    await progress.update(docId, { currentNodeId: nodeId, updatedAt: now, updatedBy: verified.identity.uid });
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
