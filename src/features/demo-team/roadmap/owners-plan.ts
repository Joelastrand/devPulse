import { isRoadmapItemFor, parseRoadmapItem, roadmapItemDocId, type RoadmapItemRecord } from "../../roadmap/domain/roadmap-item";
import {
  openRoadmapItemDocument,
  toPersistedRoadmapItem,
  type OpenRoadmapContent,
  type SealRoadmapContent,
} from "../../roadmap/domain/roadmap-item-content-codec";
import { DEMO_AUDIT_ACTOR } from "../fixtures";
import { resolveOwnerRef, type ObservedMembership, type ObservedRoadmapItem } from "./plan";

/**
 * Pure planning for the owners of the three original demo roadmap plans (Phase E2). It never reads or writes.
 *
 * The owner is the only business field that changes. Every other field (target node, priority, status, dates, completedAt) is
 * re-sealed unchanged from the record that was read in the same transaction. Only `content`, `ownerRefIndex`, `updatedAt` and
 * `updatedBy` are written; `createdAt` and `createdBy` are never touched.
 *
 * Per assignment:
 *   - the owner's membership must resolve to a valid, unique memberRef of this team (same rules as the create seed);
 *   - the roadmap document must exist, open and parse, and belong to this team and tree under its own document id;
 *   - an owner already equal to the resolved memberRef is a skip (identical rerun, zero writes);
 *   - an owner already set to anything else is a conflict. Owners are never replaced;
 *   - otherwise the document is updated with the owner field set.
 */

export interface OwnerAssignment {
  treeId: string;
  ownerUid: string;
}

export interface OwnerPlanInput {
  teamId: string;
  now: Date;
  assignments: readonly OwnerAssignment[];
  members: ReadonlyMap<string, ObservedMembership>;
  teamMemberships: readonly unknown[];
  erasing: ReadonlySet<string>;
  roadmapItems: ReadonlyMap<string, ObservedRoadmapItem>;
  openRecord: OpenRoadmapContent;
  sealRecord: SealRoadmapContent;
}

export type OwnerAction = "update" | "skip" | "conflict";

export interface OwnerFields {
  content: Record<string, unknown>;
  ownerRefIndex: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface OwnerPlanEntry {
  treeId: string;
  docId: string;
  ownerUid: string;
  action: OwnerAction;
  reason?: string;
  /** The exact fields the update writes. Present only for `update`. */
  fields?: OwnerFields;
  /** The record as read, for the post-write verification of unchanged business fields. */
  before?: RoadmapItemRecord;
}

export interface OwnerProvisioningPlan {
  entries: OwnerPlanEntry[];
  counts: Record<OwnerAction, number>;
  noConflicts: boolean;
}

/** Opens and parses one stored roadmap document, or returns the reason it cannot be used. */
function readRecord(
  raw: unknown,
  docId: string,
  teamId: string,
  treeId: string,
  openRecord: OpenRoadmapContent,
): { ok: true; record: RoadmapItemRecord } | { ok: false; reason: string } {
  const opened = openRoadmapItemDocument(raw, openRecord);
  if (opened === undefined) return { ok: false, reason: "roadmap-item-missing" };
  if (opened === null) return { ok: false, reason: "roadmap-item-unreadable" };
  const record = parseRoadmapItem(opened);
  if (record === null) return { ok: false, reason: "roadmap-item-unreadable" };
  if (!isRoadmapItemFor(record, docId, teamId, treeId)) return { ok: false, reason: "roadmap-item-other-team" };
  return { ok: true, record };
}

export function planOwnerAssignments(input: OwnerPlanInput): OwnerProvisioningPlan {
  const entries: OwnerPlanEntry[] = input.assignments.map((assignment) => {
    const docId = roadmapItemDocId(input.teamId, assignment.treeId);
    const base = { treeId: assignment.treeId, docId, ownerUid: assignment.ownerUid };

    const owner = resolveOwnerRef(assignment.ownerUid, input);
    if (!owner.ok) return { ...base, action: "conflict", reason: owner.reason };

    const stored = readRecord(input.roadmapItems.get(docId)?.raw, docId, input.teamId, assignment.treeId, input.openRecord);
    if (!stored.ok) return { ...base, action: "conflict", reason: stored.reason };
    const before = stored.record;

    if (before.ownerRef === owner.memberRef) return { ...base, action: "skip", before };
    if (before.ownerRef !== undefined) return { ...base, action: "conflict", reason: "owner-already-set", before };

    const next: RoadmapItemRecord = { ...before, ownerRef: owner.memberRef, updatedAt: input.now, updatedBy: DEMO_AUDIT_ACTOR };
    const persisted = toPersistedRoadmapItem({ ...next }, input.sealRecord);
    return {
      ...base,
      action: "update",
      before,
      fields: {
        content: persisted.content as Record<string, unknown>,
        ownerRefIndex: persisted.ownerRefIndex as string,
        updatedAt: input.now,
        updatedBy: DEMO_AUDIT_ACTOR,
      },
    };
  });

  const counts: Record<OwnerAction, number> = { update: 0, skip: 0, conflict: 0 };
  for (const entry of entries) counts[entry.action] += 1;
  return { entries, counts, noConflicts: counts.conflict === 0 };
}
