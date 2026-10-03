import "server-only";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { getDisplayNames, type ProfileBatchReader } from "../../profiles/server/get-display-names";
import { isValidSkillProgress, skillProgressDocId } from "../../skill-trees/domain/skill-progress";
import { isValidSkillTree, type SkillTreeRecord } from "../../skill-trees/domain/skill-tree";
import { resolveMemberRef } from "../../teams/domain/member-ref";
import { isValidTeamStatus } from "../../teams/domain/team";
import {
  extractMemberUid,
  isValidMembershipFor,
  membershipDocId,
} from "../../teams/domain/team-membership";
import { isValidPlanDate, planningToday, validatePlanDateRange } from "../domain/roadmap-dates";
import {
  applyStatusTransition,
  isRoadmapItemFor,
  isRoadmapPriority,
  isRoadmapStatus,
  parseRoadmapItem,
  roadmapItemDocId,
  type RoadmapItemRecord,
  type RoadmapPriority,
  type RoadmapStatus,
} from "../domain/roadmap-item";
import { validateTargetNode } from "../domain/roadmap-target";
import {
  ROADMAP_ITEMS_MAX,
  arrangeOwners,
  eligibleOwnerMembers,
  mapDates,
  toRoadmapItemView,
  type RoadmapItemView,
  type RoadmapOwner,
} from "./list-roadmap-items";

const ROADMAP_COLLECTION = "roadmapItems";
const SKILL_PROGRESS_COLLECTION = "skillProgress";
const SKILL_TREES_COLLECTION = "skillTrees";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const TEAMS_COLLECTION = "teams";

const ALLOWED_KEYS = ["targetNodeId", "priority", "status", "startDate", "targetDate", "ownerRef", "archived"];

export type UpdateRoadmapItemError =
  | "unauthenticated"
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "invalid_input"
  | "target_not_ahead"
  | "invalid_owner"
  | "not_tracked"
  | "tree_not_found"
  | "not_found"
  | "archived"
  | "persistence_failed";

export type UpdateRoadmapItemResult =
  | { ok: true; item: RoadmapItemView }
  | { ok: false; error: UpdateRoadmapItemError };

/** Partial write: `set` fields are merged, `remove` fields are deleted from the stored document. */
export interface RoadmapPatch {
  set: Record<string, unknown>;
  remove: string[];
}

/** Reads inside the update transaction (raw, unvalidated) plus the single partial `update`. */
export interface UpdateRoadmapTx {
  getTeamStatus(teamId: string): Promise<unknown>;
  getMembership(uid: string, teamId: string): Promise<unknown>;
  getRoadmapItem(docId: string): Promise<unknown>;
  getSkillProgress(docId: string): Promise<unknown>;
  getSkillTree(treeId: string): Promise<unknown>;
  listMemberships(teamId: string, limit: number): Promise<unknown[]>;
  update(docId: string, patch: RoadmapPatch): void;
}

/** Non-transactional, presentation-only reads used after commit (failures are tolerated). */
export interface PresentationState {
  progress: unknown;
  tree: unknown;
  memberships: unknown[];
}

export interface UpdateRoadmapStore {
  runTransaction<T>(fn: (tx: UpdateRoadmapTx) => Promise<T>): Promise<T>;
  readPresentation(teamId: string, treeId: string): Promise<PresentationState>;
}

function getDefaultStore(): UpdateRoadmapStore {
  return {
    runTransaction(fn) {
      const db = getFirestoreDb();
      return db.runTransaction((tx: Transaction) => {
        const data = async (ref: FirebaseFirestore.DocumentReference, dateFields: string[]) => {
          const snapshot = await tx.get(ref);
          return snapshot.exists ? mapDates(snapshot.data(), dateFields) : undefined;
        };
        return fn({
          async getTeamStatus(teamId) {
            const snapshot = await tx.get(db.collection(TEAMS_COLLECTION).doc(teamId));
            return snapshot.exists ? snapshot.data()?.status : undefined;
          },
          async getMembership(uid, teamId) {
            const snapshot = await tx.get(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          getRoadmapItem: (docId) =>
            data(db.collection(ROADMAP_COLLECTION).doc(docId), ["createdAt", "updatedAt", "completedAt", "archivedAt"]),
          getSkillProgress: (docId) => data(db.collection(SKILL_PROGRESS_COLLECTION).doc(docId), ["updatedAt"]),
          getSkillTree: (treeId) => data(db.collection(SKILL_TREES_COLLECTION).doc(treeId), ["createdAt", "updatedAt"]),
          async listMemberships(teamId, limit) {
            const snapshot = await tx.get(
              db.collection(MEMBERSHIPS_COLLECTION).where("teamId", "==", teamId).limit(limit),
            );
            return snapshot.docs.map((doc) => doc.data());
          },
          update(docId, patch) {
            const fields: Record<string, unknown> = { ...patch.set };
            for (const field of patch.remove) fields[field] = FieldValue.delete();
            tx.update(db.collection(ROADMAP_COLLECTION).doc(docId), fields);
          },
        });
      });
    },
    async readPresentation(teamId, treeId) {
      const db = getFirestoreDb();
      const [progress, tree, memberships] = await Promise.all([
        db.collection(SKILL_PROGRESS_COLLECTION).doc(skillProgressDocId(teamId, treeId)).get(),
        db.collection(SKILL_TREES_COLLECTION).doc(treeId).get(),
        db.collection(MEMBERSHIPS_COLLECTION).where("teamId", "==", teamId).limit(ROADMAP_ITEMS_MAX + 1).get(),
      ]);
      return {
        progress: progress.exists ? mapDates(progress.data(), ["updatedAt"]) : undefined,
        tree: tree.exists ? mapDates(tree.data(), ["createdAt", "updatedAt"]) : undefined,
        memberships: memberships.docs.map((doc) => doc.data()),
      };
    },
  };
}

export interface UpdateRoadmapItemDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: UpdateRoadmapStore;
  profileReader?: ProfileBatchReader;
  now?: () => Date;
}

interface PatchBody {
  targetNodeId?: string;
  priority?: RoadmapPriority;
  status?: RoadmapStatus;
  /** `undefined` = unchanged, `null` = clear. */
  startDate?: string | null;
  targetDate?: string | null;
  /** `undefined` = unchanged, `null` = clear; any other value is resolved against current memberships. */
  ownerRef?: unknown;
  archived?: boolean;
}

/** Strict allow-list parse. `invalid_request` = wrong envelope; `invalid_input` = bad field value. */
function parseBody(body: unknown): PatchBody | "invalid_request" | "invalid_input" {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "invalid_request";
  const r = body as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length === 0 || keys.some((key) => !ALLOWED_KEYS.includes(key))) return "invalid_request";
  if ("archived" in r && keys.length !== 1) return "invalid_request";

  const parsed: PatchBody = {};
  if ("archived" in r) {
    if (typeof r.archived !== "boolean") return "invalid_input";
    parsed.archived = r.archived;
    return parsed;
  }
  if ("targetNodeId" in r) {
    if (typeof r.targetNodeId !== "string" || r.targetNodeId.length === 0) return "invalid_input";
    parsed.targetNodeId = r.targetNodeId;
  }
  if ("priority" in r) {
    if (!isRoadmapPriority(r.priority)) return "invalid_input";
    parsed.priority = r.priority;
  }
  if ("status" in r) {
    if (!isRoadmapStatus(r.status)) return "invalid_input";
    parsed.status = r.status;
  }
  for (const key of ["startDate", "targetDate"] as const) {
    if (key in r) {
      if (r[key] !== null && !isValidPlanDate(r[key])) return "invalid_input";
      parsed[key] = r[key] as string | null;
    }
  }
  if ("ownerRef" in r) parsed.ownerRef = r.ownerRef;
  return parsed;
}

interface CommittedSnapshot {
  record: RoadmapItemRecord;
  /** Raw tree/progress/memberships when the transaction already read them. */
  tree?: unknown;
  progress?: unknown;
  memberships?: readonly unknown[];
}

type TxOutcome = { ok: true; snapshot: CommittedSnapshot } | { ok: false; error: UpdateRoadmapItemError };

/**
 * Updates, archives or restores the plan for (team, tree) (SPEC — BR-14, 17–22;
 * D1, D2, D7, D8, D13). `teamId`/`treeId` come from the route only.
 *
 * One transaction; every read precedes the only write (`tx.update`, partial
 * fields). W = genuine caller membership (`forbidden`) on an `active` team
 * (`team_disabled`); lead and app-admin status add nothing. The stored
 * document must pass the consistency rule or it is `not_found`. An archived
 * plan accepts only `{archived:false}` (`archived` otherwise); archive-on-
 * archived and restore-on-active are successful no-ops without a write.
 * Progress/tree are read only when `targetNodeId` changes (untracked ⇒
 * `not_tracked`); memberships only when `ownerRef` is set to a new value. A
 * persisted `completedAt` is removed (field delete) when leaving `completed`.
 * Progress and memberships are never written. The response is built from the
 * validated transaction state; post-commit presentation reads are fail-soft.
 */
export async function updateRoadmapItem(
  idToken: string,
  teamId: string,
  treeId: string,
  body: unknown,
  deps: UpdateRoadmapItemDeps = {},
): Promise<UpdateRoadmapItemResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: "unauthenticated" };
  const uid = verified.identity.uid;

  const parsed = parseBody(body);
  if (parsed === "invalid_request" || parsed === "invalid_input") return { ok: false, error: parsed };
  // `/` would turn the deterministic id into a sub-path.
  if (treeId.length === 0 || treeId.includes("/")) return { ok: false, error: "not_found" };

  const now = (deps.now ?? (() => new Date()))();
  const store = deps.store ?? getDefaultStore();
  const docId = roadmapItemDocId(teamId, treeId);

  let outcome: TxOutcome;
  try {
    outcome = await store.runTransaction(async (tx): Promise<TxOutcome> => {
      const fail = (error: UpdateRoadmapItemError): TxOutcome => ({ ok: false, error });

      const membership = await tx.getMembership(uid, teamId);
      if (!isValidMembershipFor(membership, { uid, teamId })) return fail("forbidden");
      const teamStatus = await tx.getTeamStatus(teamId);
      if (!isValidTeamStatus(teamStatus) || teamStatus !== "active") return fail("team_disabled");

      const raw = await tx.getRoadmapItem(docId);
      const existing = raw === undefined ? null : parseRoadmapItem(raw);
      if (existing === null || !isRoadmapItemFor(existing, docId, teamId, treeId)) return fail("not_found");

      const isArchived = existing.archivedAt !== undefined;

      // Archive / restore (sole key).
      if (parsed.archived !== undefined) {
        if (parsed.archived === isArchived) return { ok: true, snapshot: { record: existing } };
        const record: RoadmapItemRecord = { ...existing, updatedAt: now, updatedBy: uid };
        const patch: RoadmapPatch = { set: { updatedAt: now, updatedBy: uid }, remove: [] };
        if (parsed.archived) {
          record.archivedAt = now;
          record.archivedBy = uid;
          patch.set.archivedAt = now;
          patch.set.archivedBy = uid;
        } else {
          delete record.archivedAt;
          delete record.archivedBy;
          patch.remove.push("archivedAt", "archivedBy");
        }
        tx.update(docId, patch);
        return { ok: true, snapshot: { record } };
      }
      if (isArchived) return fail("archived");

      const record: RoadmapItemRecord = { ...existing, updatedAt: now, updatedBy: uid };
      const patch: RoadmapPatch = { set: { updatedAt: now, updatedBy: uid }, remove: [] };

      // Dates: validate the merged result before any further read.
      const startDate = parsed.startDate === undefined ? existing.startDate : (parsed.startDate ?? undefined);
      const targetDate = parsed.targetDate === undefined ? existing.targetDate : (parsed.targetDate ?? undefined);
      if (!validatePlanDateRange(startDate, targetDate)) return fail("invalid_input");

      const retarget = parsed.targetNodeId !== undefined && parsed.targetNodeId !== existing.targetNodeId;
      const newOwner =
        parsed.ownerRef !== undefined && parsed.ownerRef !== null && parsed.ownerRef !== existing.ownerRef;

      let progress: unknown;
      let rawTree: unknown;
      let memberships: unknown[] | undefined;
      if (retarget) {
        progress = await tx.getSkillProgress(skillProgressDocId(teamId, treeId));
        rawTree = await tx.getSkillTree(treeId);
      }
      if (newOwner) memberships = await tx.listMemberships(teamId, ROADMAP_ITEMS_MAX + 1);

      if (retarget) {
        if (!isValidSkillProgress(progress) || progress.teamId !== teamId || progress.treeId !== treeId) {
          return fail("not_tracked");
        }
        if (!isValidSkillTree(rawTree)) return fail("tree_not_found");
        const target = validateTargetNode(rawTree, progress.currentNodeId, parsed.targetNodeId);
        if (!target.ok) return fail(target.error);
        record.targetNodeId = parsed.targetNodeId as string;
        patch.set.targetNodeId = record.targetNodeId;
      }

      if (newOwner) {
        const owner = resolveMemberRef((memberships ?? []).slice(0, ROADMAP_ITEMS_MAX), teamId, parsed.ownerRef);
        if (owner === null || extractMemberUid(owner) === null || typeof parsed.ownerRef !== "string") {
          return fail("invalid_owner");
        }
        record.ownerRef = parsed.ownerRef;
        patch.set.ownerRef = parsed.ownerRef;
      } else if (parsed.ownerRef === null) {
        delete record.ownerRef;
        patch.remove.push("ownerRef");
      }

      if (parsed.priority !== undefined) {
        record.priority = parsed.priority;
        patch.set.priority = parsed.priority;
      }

      for (const key of ["startDate", "targetDate"] as const) {
        const value = parsed[key];
        if (value === undefined) continue;
        if (value === null) {
          delete record[key];
          patch.remove.push(key);
        } else {
          record[key] = value;
          patch.set[key] = value;
        }
      }

      if (parsed.status !== undefined) {
        const next = applyStatusTransition(existing, parsed.status, now);
        record.status = next.status;
        patch.set.status = next.status;
        if (next.completedAt !== null) {
          record.completedAt = next.completedAt;
          // Unchanged completedAt (completed -> completed) needs no rewrite.
          if (next.completedAt !== existing.completedAt) patch.set.completedAt = next.completedAt;
        } else if (existing.completedAt !== undefined) {
          // The domain helper's `null` means "remove"; a literal null is never persisted.
          delete record.completedAt;
          patch.remove.push("completedAt");
        }
      }

      tx.update(docId, patch);
      return { ok: true, snapshot: { record, tree: rawTree, progress, memberships } };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  if (!outcome.ok) return outcome;

  // The transaction has committed: nothing below may turn success into a failure.
  const item = await buildItem(outcome.snapshot, store, teamId, uid, deps.profileReader, now);
  return { ok: true, item };
}

async function buildItem(
  snapshot: CommittedSnapshot,
  store: UpdateRoadmapStore,
  teamId: string,
  uid: string,
  profileReader: ProfileBatchReader | undefined,
  now: Date,
): Promise<RoadmapItemView> {
  const { record } = snapshot;
  let { tree, progress, memberships } = snapshot;
  const needsPresentation = tree === undefined || (record.ownerRef !== undefined && memberships === undefined);
  if (needsPresentation) {
    try {
      const state = await store.readPresentation(teamId, record.treeId);
      tree ??= state.tree;
      progress ??= state.progress;
      memberships ??= state.memberships;
    } catch {
      // Presentation only: degrade below.
    }
  }

  const validTree: SkillTreeRecord | null = isValidSkillTree(tree) ? tree : null;
  const trackedProgress =
    validTree !== null &&
    isValidSkillProgress(progress) &&
    progress.teamId === teamId &&
    progress.treeId === record.treeId
      ? progress
      : null;

  const owner = await resolveOwner(record, memberships ?? [], teamId, uid, profileReader);
  return toRoadmapItemView(
    record,
    { tree: validTree, tracked: trackedProgress !== null, currentNodeId: trackedProgress?.currentNodeId ?? null, owner },
    planningToday(now),
  );
}

/** Presentation-only owner; a display-name read failure degrades to `unavailable` (no uid/e-mail fallback). */
async function resolveOwner(
  record: RoadmapItemRecord,
  memberships: readonly unknown[],
  teamId: string,
  uid: string,
  profileReader: ProfileBatchReader | undefined,
): Promise<RoadmapOwner> {
  if (record.ownerRef === undefined) return null;
  try {
    const bounded = memberships.slice(0, ROADMAP_ITEMS_MAX);
    const eligible = eligibleOwnerMembers(bounded, teamId);
    const names = await getDisplayNames(
      eligible.map((member) => member.uid),
      { reader: profileReader },
    );
    return (
      arrangeOwners(bounded, teamId, uid, [record.ownerRef], names, eligible).get(record.ownerRef) ?? {
        state: "unavailable",
      }
    );
  } catch {
    return { state: "unavailable" };
  }
}
