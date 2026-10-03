import "server-only";
import type { Transaction } from "firebase-admin/firestore";
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
import { planningToday, validatePlanDateRange, isValidPlanDate } from "../domain/roadmap-dates";
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

const ALLOWED_KEYS = ["treeId", "targetNodeId", "priority", "status", "startDate", "targetDate", "ownerRef"];

export type CreateRoadmapItemError =
  | "unauthenticated"
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "invalid_input"
  | "target_not_ahead"
  | "invalid_owner"
  | "not_tracked"
  | "tree_not_found"
  | "already_planned"
  | "plan_archived"
  | "persistence_failed";

export type CreateRoadmapItemResult =
  | { ok: true; item: RoadmapItemView }
  | { ok: false; error: CreateRoadmapItemError };

/**
 * Reads available inside the create transaction (raw, unvalidated data) plus
 * the single `create` write. `createRoadmapItem` issues every read before the
 * write; `create` must fail if the document already exists.
 */
export interface CreateRoadmapTx {
  getTeamStatus(teamId: string): Promise<unknown>;
  getMembership(uid: string, teamId: string): Promise<unknown>;
  getSkillProgress(docId: string): Promise<unknown>;
  getSkillTree(treeId: string): Promise<unknown>;
  /** Raw stored document, or `undefined` when the slot is free. */
  getRoadmapItem(docId: string): Promise<unknown>;
  listMemberships(teamId: string, limit: number): Promise<unknown[]>;
  create(docId: string, data: Record<string, unknown>): void;
}

export interface CreateRoadmapStore {
  runTransaction<T>(fn: (tx: CreateRoadmapTx) => Promise<T>): Promise<T>;
}

function getDefaultStore(): CreateRoadmapStore {
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
          getSkillProgress: (docId) => data(db.collection(SKILL_PROGRESS_COLLECTION).doc(docId), ["updatedAt"]),
          getSkillTree: (treeId) => data(db.collection(SKILL_TREES_COLLECTION).doc(treeId), ["createdAt", "updatedAt"]),
          getRoadmapItem: (docId) =>
            data(db.collection(ROADMAP_COLLECTION).doc(docId), ["createdAt", "updatedAt", "completedAt", "archivedAt"]),
          async listMemberships(teamId, limit) {
            const snapshot = await tx.get(
              db.collection(MEMBERSHIPS_COLLECTION).where("teamId", "==", teamId).limit(limit),
            );
            return snapshot.docs.map((doc) => doc.data());
          },
          create(docId, record) {
            tx.create(db.collection(ROADMAP_COLLECTION).doc(docId), record);
          },
        });
      });
    },
  };
}

export interface CreateRoadmapItemDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: CreateRoadmapStore;
  profileReader?: ProfileBatchReader;
  now?: () => Date;
}

interface ParsedBody {
  treeId: string;
  targetNodeId: string;
  priority: RoadmapPriority;
  status: RoadmapStatus;
  startDate?: string;
  targetDate?: string;
  /** Present-but-unvalidated; shape and resolution are checked against current memberships. */
  ownerRef?: unknown;
}

/** Strict allow-list parse. `invalid_request` = wrong envelope; `invalid_input` = bad field value. */
function parseBody(body: unknown): ParsedBody | "invalid_request" | "invalid_input" {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "invalid_request";
  }
  const r = body as Record<string, unknown>;
  if (Object.keys(r).some((key) => !ALLOWED_KEYS.includes(key))) {
    return "invalid_request";
  }

  const { treeId, targetNodeId, priority, status, startDate, targetDate } = r;
  // `/` would turn the deterministic id into a sub-path.
  if (typeof treeId !== "string" || treeId.length === 0 || treeId.includes("/")) return "invalid_input";
  if (typeof targetNodeId !== "string" || targetNodeId.length === 0) return "invalid_input";
  if (priority !== undefined && !isRoadmapPriority(priority)) return "invalid_input";
  if (status !== undefined && !isRoadmapStatus(status)) return "invalid_input";
  if (startDate !== undefined && !isValidPlanDate(startDate)) return "invalid_input";
  if (targetDate !== undefined && !isValidPlanDate(targetDate)) return "invalid_input";
  if (!validatePlanDateRange(startDate, targetDate)) return "invalid_input";

  const parsed: ParsedBody = {
    treeId,
    targetNodeId,
    priority: priority ?? "medium",
    status: status ?? "planned",
  };
  if (startDate !== undefined) parsed.startDate = startDate;
  if (targetDate !== undefined) parsed.targetDate = targetDate;
  if ("ownerRef" in r && r.ownerRef !== undefined) parsed.ownerRef = r.ownerRef;
  return parsed;
}

/**
 * State validated inside the transaction, returned so the 201 body is built
 * without any post-commit read of invariant-bearing data (snapshot semantics;
 * GET is the live view).
 */
interface CommittedSnapshot {
  record: RoadmapItemRecord;
  tree: SkillTreeRecord;
  currentNodeId: string | null;
  /** Raw team memberships; empty unless an owner was supplied (already validated to resolve). */
  memberships: readonly unknown[];
}

type TxOutcome = { ok: true; snapshot: CommittedSnapshot } | { ok: false; error: CreateRoadmapItemError };

/**
 * Creates the single plan for (team, competency area) (SPEC — BR-13, 15, 16,
 * 19; D1, D2, D6, D13). `teamId` comes from the route only.
 *
 * One transaction; every read precedes the only write (`tx.create`, which
 * fails on an existing document, so concurrent creates have one winner):
 * team status, the caller's membership, progress, tree, the roadmap slot and
 * — only when `ownerRef` is supplied — the team's memberships. W = a genuine
 * membership for the caller (else `forbidden`) on an `active` team (else
 * `team_disabled`); lead and app-admin status add nothing. Tracking is
 * required and never started; progress/memberships are never written. Target
 * rules via `validateTargetNode`. An existing slot — archived included — is
 * never overwritten (`already_planned` / `plan_archived`). The document id
 * is uniqueness only; teamId/treeId are stored explicitly.
 */
export async function createRoadmapItem(
  idToken: string,
  teamId: string,
  body: unknown,
  deps: CreateRoadmapItemDeps = {},
): Promise<CreateRoadmapItemResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }
  const uid = verified.identity.uid;

  const parsed = parseBody(body);
  if (parsed === "invalid_request" || parsed === "invalid_input") {
    return { ok: false, error: parsed };
  }

  const now = (deps.now ?? (() => new Date()))();
  const store = deps.store ?? getDefaultStore();

  let outcome: TxOutcome;
  try {
    outcome = await store.runTransaction(async (tx): Promise<TxOutcome> => {
      const fail = (error: CreateRoadmapItemError): TxOutcome => ({ ok: false, error });

      const membership = await tx.getMembership(uid, teamId);
      if (!isValidMembershipFor(membership, { uid, teamId })) {
        return fail("forbidden");
      }
      const teamStatus = await tx.getTeamStatus(teamId);
      if (!isValidTeamStatus(teamStatus) || teamStatus !== "active") {
        return fail("team_disabled");
      }

      const progressDocId = skillProgressDocId(teamId, parsed.treeId);
      const progress = await tx.getSkillProgress(progressDocId);
      const rawTree = await tx.getSkillTree(parsed.treeId);
      const slot = await tx.getRoadmapItem(roadmapItemDocId(teamId, parsed.treeId));
      const memberships =
        parsed.ownerRef === undefined ? [] : await tx.listMemberships(teamId, ROADMAP_ITEMS_MAX + 1);

      if (!isValidSkillProgress(progress) || progress.teamId !== teamId || progress.treeId !== parsed.treeId) {
        return fail("not_tracked");
      }
      if (!isValidSkillTree(rawTree)) {
        return fail("tree_not_found");
      }
      const target = validateTargetNode(rawTree, progress.currentNodeId, parsed.targetNodeId);
      if (!target.ok) {
        return fail(target.error);
      }

      if (parsed.ownerRef !== undefined) {
        const owner = resolveMemberRef(memberships.slice(0, ROADMAP_ITEMS_MAX), teamId, parsed.ownerRef);
        if (owner === null || extractMemberUid(owner) === null) {
          return fail("invalid_owner");
        }
      }

      if (slot !== undefined) {
        const existing = parseRoadmapItem(slot);
        const consistent = existing !== null && isRoadmapItemFor(existing, roadmapItemDocId(teamId, parsed.treeId), teamId, parsed.treeId);
        return fail(consistent && existing.archivedAt !== undefined ? "plan_archived" : "already_planned");
      }

      const record: RoadmapItemRecord = {
        teamId,
        treeId: parsed.treeId,
        targetNodeId: parsed.targetNodeId,
        priority: parsed.priority,
        status: parsed.status,
        createdAt: now,
        createdBy: uid,
        updatedAt: now,
        updatedBy: uid,
      };
      if (parsed.startDate !== undefined) record.startDate = parsed.startDate;
      if (parsed.targetDate !== undefined) record.targetDate = parsed.targetDate;
      if (typeof parsed.ownerRef === "string") record.ownerRef = parsed.ownerRef;
      const { completedAt } = applyStatusTransition({ status: "planned" }, parsed.status, now);
      if (completedAt !== null) record.completedAt = completedAt;

      tx.create(roadmapItemDocId(teamId, parsed.treeId), { ...record });
      return {
        ok: true,
        snapshot: {
          record,
          tree: rawTree,
          currentNodeId: progress.currentNodeId,
          memberships: memberships.slice(0, ROADMAP_ITEMS_MAX),
        },
      };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  if (!outcome.ok) {
    return outcome;
  }

  // The transaction has committed: nothing below may turn success into a failure.
  const { record, tree, currentNodeId, memberships } = outcome.snapshot;
  const owner = await resolveCreatedOwner(record, memberships, teamId, uid, deps.profileReader);
  const item = toRoadmapItemView(record, { tree, tracked: true, currentNodeId, owner }, planningToday(now));
  return { ok: true, item };
}

/**
 * Presentation-only owner for the 201 body, from the validated membership
 * snapshot. Display names are the only read after commit; if it fails the
 * owner degrades to `unavailable` (no uid/e-mail fallback, nothing persisted).
 */
async function resolveCreatedOwner(
  record: RoadmapItemRecord,
  memberships: readonly unknown[],
  teamId: string,
  uid: string,
  profileReader: ProfileBatchReader | undefined,
): Promise<RoadmapOwner> {
  if (record.ownerRef === undefined) {
    return null;
  }
  try {
    const eligible = eligibleOwnerMembers(memberships, teamId);
    const names = await getDisplayNames(
      eligible.map((member) => member.uid),
      { reader: profileReader },
    );
    const owners = arrangeOwners(memberships, teamId, uid, [record.ownerRef], names, eligible);
    return owners.get(record.ownerRef) ?? { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}
