import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { getDisplayNames, type ProfileBatchReader } from "../../profiles/server/get-display-names";
import { isValidSkillProgress, skillProgressDocId } from "../../skill-trees/domain/skill-progress";
import { isValidSkillTree, type SkillTreeRecord } from "../../skill-trees/domain/skill-tree";
import { arrangeAssignableMembers, type AssignableCandidate } from "../../teams/domain/assignable-ordinals";
import { memberRefOf, resolveMemberRef } from "../../teams/domain/member-ref";
import { isValidTeamStatus } from "../../teams/domain/team";
import {
  extractMemberUid,
  isValidMembershipFor,
  membershipDocId,
} from "../../teams/domain/team-membership";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessDeps,
} from "../../teams/server/authorize-team-access";
import { isOverdue, planningToday } from "../domain/roadmap-dates";
import {
  isRoadmapItemFor,
  parseRoadmapItem,
  type RoadmapItemRecord,
  type RoadmapPriority,
  type RoadmapStatus,
} from "../domain/roadmap-item";
import { compareRoadmapPlans } from "../domain/roadmap-sort";
import { isTargetReached } from "../domain/roadmap-target";

const ROADMAP_COLLECTION = "roadmapItems";
const SKILL_PROGRESS_COLLECTION = "skillProgress";
const SKILL_TREES_COLLECTION = "skillTrees";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const TEAMS_COLLECTION = "teams";

/** Plans (and memberships) processed per read; one extra is requested only as the truncation signal. */
export const ROADMAP_ITEMS_MAX = 500;

export type RoadmapOwner =
  | null
  | { state: "current"; memberRef: string; displayName: string | null; ordinal: number | null; isSelf: boolean }
  | { state: "unavailable" };

export type RoadmapTracking =
  | { state: "tracked"; currentNodeId: string | null }
  | { state: "not_tracked" };

/**
 * The complete per-plan contract (SPEC — BR-9). Built field by field; never a
 * spread of a stored document, so no uid, e-mail, membership document id or
 * audit field (`createdBy`/`updatedBy`/`archivedBy`) can reach a response.
 * `areaName` is `null` only when the tree cannot be resolved (nothing is
 * guessed). `targetReached` is a boolean only when derivable; otherwise the
 * key is absent (never `null`). `overdue` is date/status-derived and always
 * present.
 */
export interface RoadmapItemView {
  treeId: string;
  areaName: string | null;
  targetNodeId: string;
  targetLabel: string | null;
  targetAvailable: boolean;
  tracking: RoadmapTracking;
  priority: RoadmapPriority;
  status: RoadmapStatus;
  startDate: string | null;
  targetDate: string | null;
  owner: RoadmapOwner;
  targetReached?: boolean;
  overdue: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ListRoadmapItemsResult =
  | { ok: true; items: RoadmapItemView[]; canEdit: boolean; truncated: boolean }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface RawDoc {
  id: string;
  data: unknown;
}

/** Read seams: Firestore in production, in-memory fakes in tests. Raw, unvalidated data; no write method exists. */
export interface RoadmapReadStore {
  listRoadmapItems(teamId: string, limit: number): Promise<RawDoc[]>;
  listSkillProgress(teamId: string): Promise<RawDoc[]>;
  getSkillTree(treeId: string): Promise<unknown>;
  listMemberships(teamId: string, limit: number): Promise<unknown[]>;
  getMembership(uid: string, teamId: string): Promise<unknown>;
  getTeamStatus(teamId: string): Promise<unknown>;
}

function toDate(value: unknown): unknown {
  if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return value;
}

export function mapDates(data: unknown, fields: string[]): unknown {
  if (typeof data !== "object" || data === null) {
    return data;
  }
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const field of fields) {
    if (field in out) out[field] = toDate(out[field]);
  }
  return out;
}

export function getDefaultRoadmapReadStore(): RoadmapReadStore {
  const db = () => getFirestoreDb();
  return {
    async listRoadmapItems(teamId, limit) {
      const snapshot = await db().collection(ROADMAP_COLLECTION).where("teamId", "==", teamId).limit(limit).get();
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        data: mapDates(doc.data(), ["createdAt", "updatedAt", "completedAt", "archivedAt"]),
      }));
    },
    async listSkillProgress(teamId) {
      const snapshot = await db().collection(SKILL_PROGRESS_COLLECTION).where("teamId", "==", teamId).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: mapDates(doc.data(), ["updatedAt"]) }));
    },
    async getSkillTree(treeId) {
      const snapshot = await db().collection(SKILL_TREES_COLLECTION).doc(treeId).get();
      return snapshot.exists ? mapDates(snapshot.data(), ["createdAt", "updatedAt"]) : undefined;
    },
    async listMemberships(teamId, limit) {
      const snapshot = await db().collection(MEMBERSHIPS_COLLECTION).where("teamId", "==", teamId).limit(limit).get();
      return snapshot.docs.map((doc) => mapDates(doc.data(), ["createdAt"]));
    },
    async getMembership(uid, teamId) {
      const snapshot = await db().collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getTeamStatus(teamId) {
      const snapshot = await db().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
  };
}

export interface ListRoadmapItemsDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  /** Seam for `authorizeTeamAccess`'s own reads. */
  collection?: AuthorizeTeamAccessDeps["collection"];
  store?: RoadmapReadStore;
  profileReader?: ProfileBatchReader;
  /** Injected clock; the server — never the client — decides "today". */
  now?: () => Date;
}

/** Fresh W (SPEC — "Actors and access"): genuine membership AND an `active` team. Any failure ⇒ `false`. */
async function resolveCanEdit(store: RoadmapReadStore, uid: string, teamId: string): Promise<boolean> {
  try {
    const membership = await store.getMembership(uid, teamId);
    if (!isValidMembershipFor(membership, { uid, teamId })) {
      return false;
    }
    const status = await store.getTeamStatus(teamId);
    return isValidTeamStatus(status) && status === "active";
  } catch {
    return false;
  }
}

/**
 * Strictly read-only roadmap read (SPEC — BR-8–12, 24, 26; D9, D13). The
 * store seam has no write method, so nothing can be created, repaired,
 * materialised or persisted here.
 *
 * Authorization is `authorizeTeamAccess` (`member`/`admin`); `denied` ⇒
 * `forbidden`, an undecidable check ⇒ `read_failed`. Neither `ownerRef`, the
 * document id nor lead status is evidence of anything. `canEdit` is W
 * re-derived from a fresh membership + team status (admin non-member ⇒ false).
 *
 * Plans: only this team's (`where teamId ==`, limit 501, first 500 processed,
 * `truncated` when more). A document that fails `parseRoadmapItem` or
 * `isRoadmapItemFor` (stored team/tree + document id) is skipped. Current
 * stage comes only from a valid, id-consistent `skillProgress` record; no
 * record ⇒ `not_tracked` (the plan survives). Area name/target label are read
 * live from the tree; a missing/invalid tree or target node ⇒
 * `targetAvailable: false`, no label, no `targetReached` (`overdue` still derives
 * from dates/status). A non-string `ownerRef` parses as no owner (`null`); a
 * string ref that cannot resolve is `unavailable`. Owners resolve
 * against the team's current memberships (only read when a returned plan has
 * an owner); zero/duplicate/unparsable ⇒ `unavailable`, nothing is repaired.
 * Derived values are computed per read and never persisted.
 */
export async function listRoadmapItems(
  idToken: string,
  teamId: string,
  options: { includeArchived?: boolean } = {},
  deps: ListRoadmapItemsDeps = {},
): Promise<ListRoadmapItemsResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }
  const callerUid = verified.identity.uid;

  const authorized = await authorizeTeamAccess(verified.identity, teamId, {
    allowList: deps.allowList,
    collection: deps.collection,
  });
  if (!authorized.ok) {
    return { ok: false, error: "read_failed" };
  }
  if (authorized.access === "denied") {
    return { ok: false, error: "forbidden" };
  }

  const store = deps.store ?? getDefaultRoadmapReadStore();
  const today = planningToday((deps.now ?? (() => new Date()))());

  try {
    const rawPlans = await store.listRoadmapItems(teamId, ROADMAP_ITEMS_MAX + 1);
    const truncated = rawPlans.length > ROADMAP_ITEMS_MAX;

    const plans: RoadmapItemRecord[] = [];
    for (const { id, data } of rawPlans.slice(0, ROADMAP_ITEMS_MAX)) {
      const plan = parseRoadmapItem(data);
      if (plan === null || !isRoadmapItemFor(plan, id, teamId, plan.treeId)) {
        continue;
      }
      if (plan.archivedAt !== undefined && !options.includeArchived) {
        continue;
      }
      plans.push(plan);
    }

    const built = await buildRoadmapItemViews(store, deps, teamId, callerUid, plans, today);

    const canEdit = await resolveCanEdit(store, callerUid, teamId);
    return { ok: true, items: built, canEdit, truncated };
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

/**
 * The TASK-005 presentation mapper: plans → `RoadmapItemView[]` (current stage
 * from valid progress only, live tree labels, owners resolved against current
 * memberships), sorted. The create response shares `toRoadmapItemView`. Strictly read-only.
 */
export async function buildRoadmapItemViews(
  store: RoadmapReadStore,
  deps: { profileReader?: ProfileBatchReader },
  teamId: string,
  callerUid: string,
  plans: RoadmapItemRecord[],
  today: string,
): Promise<RoadmapItemView[]> {
  // Current stage: only a valid progress record whose id and fields agree.
  const currentByTree = new Map<string, string | null>();
  if (plans.length > 0) {
    for (const { id, data } of await store.listSkillProgress(teamId)) {
      if (
        isValidSkillProgress(data) &&
        data.teamId === teamId &&
        id === skillProgressDocId(teamId, data.treeId)
      ) {
        currentByTree.set(data.treeId, data.currentNodeId);
      }
    }
  }

  const trees = new Map<string, SkillTreeRecord | null>();
  for (const treeId of new Set(plans.map((plan) => plan.treeId))) {
    const raw = await store.getSkillTree(treeId);
    trees.set(treeId, isValidSkillTree(raw) ? raw : null);
  }

  const owners = await resolveOwners(store, deps, teamId, callerUid, plans);

  const built = plans.map((plan) =>
    toRoadmapItemView(
      plan,
      {
        tree: trees.get(plan.treeId) ?? null,
        tracked: currentByTree.has(plan.treeId),
        currentNodeId: currentByTree.get(plan.treeId) ?? null,
        owner: plan.ownerRef === undefined ? null : (owners.get(plan.ownerRef) ?? { state: "unavailable" }),
      },
      today,
    ),
  );

  built.sort(compareRoadmapPlans);
  return built;
}

/** Already-loaded state one view is built from: live reads for GET, the validated transaction snapshot for POST. */
export interface RoadmapViewInputs {
  tree: SkillTreeRecord | null;
  tracked: boolean;
  currentNodeId: string | null;
  owner: RoadmapOwner;
}

/** Pure DTO construction (no reads) so GET and the create response share one shape. */
export function toRoadmapItemView(plan: RoadmapItemRecord, inputs: RoadmapViewInputs, today: string): RoadmapItemView {
  const { tree, tracked, currentNodeId } = inputs;
  const targetNode = tree?.nodes.find((node) => node.nodeId === plan.targetNodeId) ?? null;
  const view: RoadmapItemView = {
    treeId: plan.treeId,
    areaName: tree?.name ?? null,
    targetNodeId: plan.targetNodeId,
    targetLabel: targetNode?.label ?? null,
    targetAvailable: targetNode !== null,
    tracking: tracked ? { state: "tracked", currentNodeId } : { state: "not_tracked" },
    priority: plan.priority,
    status: plan.status,
    startDate: plan.startDate ?? null,
    targetDate: plan.targetDate ?? null,
    owner: inputs.owner,
    overdue: isOverdue(plan, today),
    archived: plan.archivedAt !== undefined,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
  if (tracked && tree !== null && targetNode !== null) {
    const reached = isTargetReached(tree, currentNodeId, plan.targetNodeId);
    if (reached !== null) view.targetReached = reached;
  }
  return view;
}

/** Memberships eligible to be an owner: well-formed, this team, valid unique ref (same set as the assignable selector). */
export function eligibleOwnerMembers(memberships: readonly unknown[], teamId: string) {
  const current = memberships.flatMap((raw) => {
    const uid = extractMemberUid(raw);
    const memberRef = memberRefOf(raw);
    if (uid === null || memberRef === null || (raw as Record<string, unknown>).teamId !== teamId) {
      return [];
    }
    const createdAt = (raw as Record<string, unknown>).createdAt;
    return [
      {
        uid,
        memberRef,
        joinedAt: createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? createdAt.getTime() : null,
      },
    ];
  });
  const refCounts = new Map<string, number>();
  for (const { memberRef } of current) {
    refCounts.set(memberRef, (refCounts.get(memberRef) ?? 0) + 1);
  }
  return current.filter((member) => refCounts.get(member.memberRef) === 1);
}

/** `ownerRef -> owner` for refs resolving to exactly one eligible current member; others are absent. */
export function arrangeOwners(
  memberships: readonly unknown[],
  teamId: string,
  callerUid: string,
  refs: Iterable<string>,
  names: ReadonlyMap<string, string>,
  eligible = eligibleOwnerMembers(memberships, teamId),
): Map<string, RoadmapOwner> {
  const candidates = eligible.map(
    (member): AssignableCandidate => ({
      memberRef: member.memberRef,
      displayName: names.get(member.uid) ?? null,
      joinedAt: member.joinedAt,
      isSelf: member.uid === callerUid,
    }),
  );
  const arranged = new Map(arrangeAssignableMembers(candidates).map((member) => [member.memberRef, member]));

  const owners = new Map<string, RoadmapOwner>();
  for (const ref of refs) {
    const resolved = resolveMemberRef(memberships, teamId, ref);
    const member = resolved === null ? undefined : arranged.get(ref);
    if (member !== undefined) {
      owners.set(ref, {
        state: "current",
        memberRef: member.memberRef,
        displayName: member.displayName,
        ordinal: member.ordinal,
        isSelf: member.isSelf,
      });
    }
  }
  return owners;
}

/** Live-read owner resolution for GET: reads current memberships and names, then arranges. */
async function resolveOwners(
  store: RoadmapReadStore,
  deps: { profileReader?: ProfileBatchReader },
  teamId: string,
  callerUid: string,
  plans: readonly RoadmapItemRecord[],
): Promise<Map<string, RoadmapOwner>> {
  const refs = new Set(plans.flatMap((plan) => (plan.ownerRef === undefined ? [] : [plan.ownerRef])));
  if (refs.size === 0) {
    return new Map();
  }

  const memberships = (await store.listMemberships(teamId, ROADMAP_ITEMS_MAX + 1)).slice(0, ROADMAP_ITEMS_MAX);
  const eligible = eligibleOwnerMembers(memberships, teamId);
  const names = await getDisplayNames(
    eligible.map((member) => member.uid),
    { reader: deps.profileReader },
  );
  return arrangeOwners(memberships, teamId, callerUid, refs, names, eligible);
}
