import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessDeps,
} from "../../teams/server/authorize-team-access";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import { isValidSkillTree, type SkillTreeRecord } from "../domain/skill-tree";
import { isValidSkillProgress, type SkillProgressRecord } from "../domain/skill-progress";

const SKILL_PROGRESS_COLLECTION = "skillProgress";
const SKILL_TREES_COLLECTION = "skillTrees";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const TEAMS_COLLECTION = "teams";

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

/**
 * The read seam for a real `teamMemberships/{uid}__{teamId}` record, mirroring
 * `list-team-challenges.ts`'s identical `MembershipReader` seam (kept as its
 * own local declaration, not a cross-module import, matching this codebase's
 * per-operation dependency-seam convention). Used only to compute
 * `canReportProgress` below; never influences which skills are returned.
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
 * The read seam for the owning team's fresh `status`, mirroring
 * `report-team-skill-progress.ts`'s identical `TeamStatusReader` seam. Used
 * only to compute `canReportProgress` below — reading team status here adds
 * no new authorization behavior of its own and never gates which skills this
 * operation returns (BR-21 — viewing a disabled team's progress is
 * unaffected).
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
 * Independently re-derives "may this caller currently call
 * `reportTeamSkillProgress` for this team," using the exact same
 * membership-then-team-status semantics that operation requires
 * (docs/features/skill-progress-self-report/SPEC.md — BR-1, BR-4) — never
 * inferred from `authorizeTeamAccess`'s broader `"admin"`/`"member"` result,
 * since an app admin short-circuits that check before membership is ever
 * read (`authorize-team-access.ts`). This is a UI-capability signal only
 * (docs/features/skill-progress-self-report/SPEC.md — "Permission-UI
 * correction"): it never gates which skills are returned by this operation,
 * and `reportTeamSkillProgress` itself remains the sole write-authorization
 * boundary, re-deriving both checks fresh on every call regardless of this
 * value. Fails closed (`false`) on any read error or malformed record — a
 * transient failure to confirm eligibility must never present a mutation
 * affordance the server would then reject anyway.
 */
async function resolveCanReportProgress(
  uid: string,
  teamId: string,
  membershipReader: MembershipReader,
  teamStatusReader: TeamStatusReader,
): Promise<boolean> {
  let rawMembership: unknown;
  try {
    rawMembership = await membershipReader.getMembership(uid, teamId);
  } catch {
    return false;
  }
  if (!isValidMembershipFor(rawMembership, { uid, teamId })) {
    return false;
  }

  let rawStatus: unknown;
  try {
    rawStatus = await teamStatusReader.getTeamStatus(teamId);
  } catch {
    return false;
  }
  return isValidTeamStatus(rawStatus) && rawStatus === "active";
}

export type GetTeamSkillProgressResult =
  | { ok: true; skills: TeamSkillProgressView[]; canReportProgress: boolean }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface GetTeamSkillProgressDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  authCollection?: AuthorizeTeamAccessDeps["collection"];
  progressReader?: SkillProgressReader;
  treeReader?: SkillTreeReader;
  membershipReader?: MembershipReader;
  teamStatusReader?: TeamStatusReader;
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
 *
 * Also returns `canReportProgress` (docs/features/skill-progress-self-report/
 * SPEC.md — "Permission-UI correction"): whether *this* caller currently
 * holds a genuine `teamMemberships/{uid}__{teamId}` record **and** the team
 * is currently `active`, re-derived independently via
 * `resolveCanReportProgress` using the exact membership-then-team-status
 * semantics `reportTeamSkillProgress` itself requires — an app admin with no
 * such record, or a genuine member of a disabled team, gets
 * `canReportProgress: false` even though their broader `authorizeTeamAccess`
 * result already let this read through. This value never affects which
 * skills are returned above; it exists solely so `/teams/[teamId]` can hide
 * its stage-mutation controls from a viewer who could never successfully use
 * them (mirrors `listTeamChallengesForMember`'s identical `canSubmit`
 * precedent — the "Challenge submission composition gap" debug fix).
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

  const canReportProgressPromise = resolveCanReportProgress(
    verified.identity.uid,
    teamId,
    deps.membershipReader ?? getDefaultMembershipReader(),
    deps.teamStatusReader ?? getDefaultTeamStatusReader(),
  );

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

  const canReportProgress = await canReportProgressPromise;

  return { ok: true, skills, canReportProgress };
}
