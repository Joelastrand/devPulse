import { memberRefOf } from "../../teams/domain/member-ref";
import { extractMemberUid } from "../../teams/domain/team-membership";
import { parseRoadmapItem, roadmapItemDocId, type RoadmapItemRecord } from "../../roadmap/domain/roadmap-item";
import {
  openRoadmapItemDocument,
  toPersistedRoadmapItem,
  type OpenRoadmapContent,
  type SealRoadmapContent,
} from "../../roadmap/domain/roadmap-item-content-codec";
import { DEMO_AUDIT_ACTOR } from "../fixtures";
import { DEMO_ROADMAP_EXPANSION, type DemoRoadmapPlan } from "./fixtures";

/**
 * Pure planning for the additional demo roadmap plans (Phase E). It never reads or writes: the runner supplies every observed
 * document, so the same decisions run inside one Firestore transaction.
 *
 * Per plan, in order:
 *   - the owner's membership must exist, be an ordinary member of this team, carry a valid memberRef that no other membership
 *     of the team shares, and have no erasure record. Missing or malformed memberRefs are conflicts (this seed never writes
 *     memberships);
 *   - the skill tree must exist;
 *   - the roadmap document id `{teamId}__{treeId}` must be absent (create), or hold exactly the fixture (skip). Anything else
 *     is a conflict. Existing plans are never overwritten.
 */

export interface ObservedMembership {
  /** Raw `teamMemberships/{uid}__{teamId}` document, or `undefined` when absent. */
  membership: unknown;
}

export interface ObservedRoadmapItem {
  /** Raw `roadmapItems/{docId}` document, or `undefined` when absent. */
  raw: unknown;
}

export interface RoadmapPlanInput {
  teamId: string;
  now: Date;
  plans?: readonly DemoRoadmapPlan[];
  /** Keyed by member uid; only the fixture owners are read. */
  members: ReadonlyMap<string, ObservedMembership>;
  /** Every membership of the team, raw, for memberRef uniqueness. */
  teamMemberships: readonly unknown[];
  /** Uids whose erasure record exists. */
  erasing: ReadonlySet<string>;
  /** Keyed by skill tree id: `true` when `skillTrees/{id}` exists. */
  skillTrees: ReadonlyMap<string, boolean>;
  /** Keyed by roadmap document id. */
  roadmapItems: ReadonlyMap<string, ObservedRoadmapItem>;
  /** Opens a sealed roadmap document. Injected so the plan stays free of key material. */
  openRecord: OpenRoadmapContent;
  sealRecord: SealRoadmapContent;
}

export type RoadmapAction = "create" | "skip" | "conflict";

export interface RoadmapPlanEntry {
  treeId: string;
  docId: string;
  ownerUid: string;
  action: RoadmapAction;
  reason?: string;
  /** Plaintext domain record for create (sealed by the caller through `persisted`). */
  record?: RoadmapItemRecord;
  /** The sealed persisted document for create. */
  persisted?: Record<string, unknown>;
}

export interface RoadmapProvisioningPlan {
  entries: RoadmapPlanEntry[];
  counts: Record<RoadmapAction, number>;
  noConflicts: boolean;
}

function membershipOk(raw: unknown, uid: string, teamId: string): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return extractMemberUid(raw) === uid && r.teamId === teamId && r.role === undefined;
}

/** Resolves an owner's memberRef, or the reason it cannot be used. */
export function resolveOwnerRef(
  uid: string,
  input: Pick<RoadmapPlanInput, "teamId" | "members" | "teamMemberships" | "erasing">,
): { ok: true; memberRef: string } | { ok: false; reason: string } {
  const observed = input.members.get(uid);
  if (observed === undefined || observed.membership === undefined) return { ok: false, reason: "owner-membership-missing" };
  if (!membershipOk(observed.membership, uid, input.teamId)) return { ok: false, reason: "owner-not-ordinary-member" };
  if (input.erasing.has(uid)) return { ok: false, reason: "erasure-record-present" };
  const ref = memberRefOf(observed.membership);
  if (ref === null) return { ok: false, reason: "owner-member-ref-missing" };
  const sharing = input.teamMemberships.filter((raw) => memberRefOf(raw) === ref).length;
  if (sharing !== 1) return { ok: false, reason: "owner-member-ref-duplicated" };
  return { ok: true, memberRef: ref };
}

/** Compares a stored roadmap plan with the fixture on every domain field. Never throws. */
function matchesFixture(raw: unknown, docId: string, expected: RoadmapItemRecord, input: RoadmapPlanInput): boolean {
  const opened = openRoadmapItemDocument(raw, input.openRecord);
  const parsed = opened === null || opened === undefined ? null : parseRoadmapItem(opened);
  if (parsed === null) return false;
  if (docId !== roadmapItemDocId(input.teamId, expected.treeId)) return false;
  return (
    parsed.teamId === expected.teamId &&
    parsed.treeId === expected.treeId &&
    parsed.targetNodeId === expected.targetNodeId &&
    parsed.priority === expected.priority &&
    parsed.status === expected.status &&
    parsed.startDate === expected.startDate &&
    parsed.targetDate === expected.targetDate &&
    parsed.ownerRef === expected.ownerRef
  );
}

export function planRoadmapExpansion(input: RoadmapPlanInput): RoadmapProvisioningPlan {
  const plans = input.plans ?? DEMO_ROADMAP_EXPANSION;
  const entries: RoadmapPlanEntry[] = plans.map((plan) => {
    const docId = roadmapItemDocId(input.teamId, plan.treeId);
    const base = { treeId: plan.treeId, docId, ownerUid: plan.ownerUid };

    const owner = resolveOwnerRef(plan.ownerUid, input);
    if (!owner.ok) return { ...base, action: "conflict", reason: owner.reason };
    if (input.skillTrees.get(plan.treeId) !== true) return { ...base, action: "conflict", reason: "skill-tree-missing" };

    const record: RoadmapItemRecord = {
      teamId: input.teamId,
      treeId: plan.treeId,
      targetNodeId: plan.targetNodeId,
      priority: plan.priority,
      status: plan.status,
      startDate: plan.startDate,
      targetDate: plan.targetDate,
      ownerRef: owner.memberRef,
      createdAt: input.now,
      createdBy: DEMO_AUDIT_ACTOR,
      updatedAt: input.now,
      updatedBy: DEMO_AUDIT_ACTOR,
    };

    const existing = input.roadmapItems.get(docId)?.raw;
    if (existing !== undefined) {
      return matchesFixture(existing, docId, record, input)
        ? { ...base, action: "skip" }
        : { ...base, action: "conflict", reason: "roadmap-item-differs" };
    }
    return {
      ...base,
      action: "create",
      record,
      persisted: toPersistedRoadmapItem({ ...record }, input.sealRecord),
    };
  });

  const counts: Record<RoadmapAction, number> = { create: 0, skip: 0, conflict: 0 };
  for (const entry of entries) counts[entry.action] += 1;
  return { entries, counts, noConflicts: counts.conflict === 0 };
}
