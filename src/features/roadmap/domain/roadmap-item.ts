import { isValidPlanDate, validatePlanDateRange } from "./roadmap-dates";

export const ROADMAP_STATUSES = ["planned", "active", "completed"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export const ROADMAP_PRIORITIES = ["high", "medium", "low"] as const;
export type RoadmapPriority = (typeof ROADMAP_PRIORITIES)[number];

export function isRoadmapStatus(value: unknown): value is RoadmapStatus {
  return typeof value === "string" && (ROADMAP_STATUSES as readonly string[]).includes(value);
}

export function isRoadmapPriority(value: unknown): value is RoadmapPriority {
  return typeof value === "string" && (ROADMAP_PRIORITIES as readonly string[]).includes(value);
}

/**
 * The persisted `roadmapItems/{teamId}__{treeId}` document shape (docs/
 * features/team-skill-planning/SPEC.md — "Firestore model"): one team's plan
 * for one competency area. Team planning metadata only.
 *
 * Deliberately absent: the current stage (owned by `skillProgress`), display
 * names, e-mail, an owner uid, labels, free text and any score.
 * `targetReached`/`overdue`/tracking state are derived per read, never stored.
 *
 * Archive is orthogonal to `status` (an archived plan keeps its status so
 * restore returns to it): `archivedAt`/`archivedBy` appear together or not at
 * all. `completedAt` exists iff `status === "completed"`. `ownerRef` is an
 * opaque team-scoped member reference — planning metadata that grants nothing.
 * `createdBy`/`updatedBy`/`archivedBy` are internal accountability uids and
 * are never returned by any response.
 */
export interface RoadmapItemRecord {
  teamId: string;
  treeId: string;
  targetNodeId: string;
  priority: RoadmapPriority;
  status: RoadmapStatus;
  startDate?: string;
  targetDate?: string;
  ownerRef?: string;
  completedAt?: Date;
  archivedAt?: Date;
  archivedBy?: string;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

/**
 * Deterministic document id: a uniqueness mechanism ONLY — one slot per
 * (team, competency area), archived plans included. It is not authentication,
 * authorization, or proof that a document belongs to a team or tree, and it is
 * never parsed back apart (SPEC — "Document id is not authorization").
 */
export function roadmapItemDocId(teamId: string, treeId: string): string {
  return `${teamId}__${treeId}`;
}

/**
 * Fail-closed consistency rule for a loaded, already-parsed document: it is
 * accepted only if its stored `teamId` and `treeId` equal the route-derived
 * pair AND the document id it was read from equals the id recomputed from that
 * pair. Any mismatch means "treat as absent". Authorization is a separate,
 * earlier concern — this never grants access.
 */
export function isRoadmapItemFor(
  item: RoadmapItemRecord,
  docId: string,
  routeTeamId: string,
  routeTreeId: string,
): boolean {
  return (
    routeTeamId.length > 0 &&
    routeTreeId.length > 0 &&
    item.teamId === routeTeamId &&
    item.treeId === routeTreeId &&
    docId === roadmapItemDocId(routeTeamId, routeTreeId)
  );
}

/**
 * Parses untrusted persisted data into a `RoadmapItemRecord`, or `null` when
 * the document is invalid (callers treat it as absent — repo convention).
 * Timestamps must already be mapped to `Date`.
 *
 * The one deliberate leniency (SPEC edge case "non-string `ownerRef` ⇒ `null`
 * owner"): a present but non-string `ownerRef` is dropped, i.e. the plan has no
 * owner. Everything else — identity, enums, dates, the completed/archived
 * pairings — fails closed.
 *
 * `allowMissingCompletedAt` is opt-in for strictly read-only callers (the
 * roadmap read): a completed plan whose `completedAt` is absent/`null` (legacy
 * data) stays readable with no `completedAt`. A present but malformed value
 * still fails closed; writers never pass the option.
 */
export function parseRoadmapItem(
  data: unknown,
  options: { allowMissingCompletedAt?: boolean } = {},
): RoadmapItemRecord | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const r = data as Record<string, unknown>;

  if (
    !isNonEmptyString(r.teamId) ||
    !isNonEmptyString(r.treeId) ||
    !isNonEmptyString(r.targetNodeId) ||
    !isRoadmapPriority(r.priority) ||
    !isRoadmapStatus(r.status) ||
    !isValidDate(r.createdAt) ||
    !isNonEmptyString(r.createdBy) ||
    !isValidDate(r.updatedAt) ||
    !isNonEmptyString(r.updatedBy)
  ) {
    return null;
  }

  if (!isOptionalPlanDate(r.startDate) || !isOptionalPlanDate(r.targetDate)) {
    return null;
  }
  if (
    !validatePlanDateRange(r.startDate as string | undefined, r.targetDate as string | undefined)
  ) {
    return null;
  }

  // completedAt exists iff the plan is completed.
  const legacyMissing =
    options.allowMissingCompletedAt === true && (r.completedAt === undefined || r.completedAt === null);
  if (r.status === "completed" ? !isValidDate(r.completedAt) && !legacyMissing : r.completedAt !== undefined) {
    return null;
  }

  // archivedAt/archivedBy: paired-optional.
  const archivedAtPresent = r.archivedAt !== undefined;
  const archivedByPresent = r.archivedBy !== undefined;
  if (archivedAtPresent !== archivedByPresent) {
    return null;
  }
  if (archivedAtPresent && (!isValidDate(r.archivedAt) || !isNonEmptyString(r.archivedBy))) {
    return null;
  }

  const item: RoadmapItemRecord = {
    teamId: r.teamId,
    treeId: r.treeId,
    targetNodeId: r.targetNodeId,
    priority: r.priority,
    status: r.status,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
  };
  if (r.startDate !== undefined) item.startDate = r.startDate as string;
  if (r.targetDate !== undefined) item.targetDate = r.targetDate as string;
  if (typeof r.ownerRef === "string") item.ownerRef = r.ownerRef;
  if (isValidDate(r.completedAt)) item.completedAt = r.completedAt;
  if (archivedAtPresent) {
    item.archivedAt = r.archivedAt as Date;
    item.archivedBy = r.archivedBy as string;
  }
  return item;
}

/**
 * Status transition with `completedAt` bookkeeping (SPEC — "Status and
 * archive"): every transition among planned/active/completed is allowed;
 * `completedAt` is set on entering `completed`, kept while it stays
 * `completed`, and removed (`null`) on leaving. Archive state is not touched.
 */
export function applyStatusTransition(
  current: { status: RoadmapStatus; completedAt?: Date },
  next: RoadmapStatus,
  now: Date,
): { status: RoadmapStatus; completedAt: Date | null } {
  if (next !== "completed") {
    return { status: next, completedAt: null };
  }
  return { status: next, completedAt: current.status === "completed" && current.completedAt ? current.completedAt : now };
}

function isOptionalPlanDate(value: unknown): boolean {
  return value === undefined || isValidPlanDate(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
