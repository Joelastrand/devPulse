import {
  isRoadmapPriority,
  isRoadmapStatus,
} from "../domain/roadmap-item";
import type { RoadmapItemView, RoadmapOwner, RoadmapTracking } from "../server/list-roadmap-items";

/**
 * Client gateway for `GET /api/teams/[teamId]/roadmap-items` (docs/features/
 * team-skill-planning/SPEC.md — BR-8). A thin `fetch` wrapper: no Firestore
 * access. Each item is rebuilt field by field from the validated response, so
 * anything unexpected a body might carry is dropped, and the optional
 * `targetReached` key stays absent unless it is a real boolean. A malformed
 * response fails safe to `read_failed`. The client parser is not the privacy
 * boundary (the server is). Plans are returned as fetched — including plans
 * of areas the team no longer tracks — so later UI can use them.
 */

export type RoadmapItemsResult =
  | { status: "ok"; items: RoadmapItemView[]; canEdit: boolean; truncated: boolean }
  | { status: "unauthenticated" | "forbidden" | "read_failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseOwner(value: unknown): RoadmapOwner | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (value.state === "unavailable") return { state: "unavailable" };
  if (
    value.state === "current" &&
    isNonEmptyString(value.memberRef) &&
    (value.displayName === null || isNonEmptyString(value.displayName)) &&
    (value.ordinal === null || (Number.isInteger(value.ordinal) && (value.ordinal as number) > 0)) &&
    typeof value.isSelf === "boolean"
  ) {
    return {
      state: "current",
      memberRef: value.memberRef,
      displayName: value.displayName as string | null,
      ordinal: value.ordinal as number | null,
      isSelf: value.isSelf,
    };
  }
  return undefined;
}

function parseTracking(value: unknown): RoadmapTracking | undefined {
  if (!isRecord(value)) return undefined;
  if (value.state === "not_tracked") return { state: "not_tracked" };
  if (value.state === "tracked" && isNullableString(value.currentNodeId)) {
    return { state: "tracked", currentNodeId: value.currentNodeId };
  }
  return undefined;
}

function parseItem(value: unknown): RoadmapItemView | null {
  if (!isRecord(value)) return null;
  const owner = parseOwner(value.owner);
  const tracking = parseTracking(value.tracking);
  if (
    !isNonEmptyString(value.treeId) ||
    !isNullableString(value.areaName) ||
    !isNonEmptyString(value.targetNodeId) ||
    !isNullableString(value.targetLabel) ||
    typeof value.targetAvailable !== "boolean" ||
    tracking === undefined ||
    !isRoadmapPriority(value.priority) ||
    !isRoadmapStatus(value.status) ||
    !isNullableString(value.startDate) ||
    !isNullableString(value.targetDate) ||
    owner === undefined ||
    typeof value.overdue !== "boolean" ||
    typeof value.archived !== "boolean" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isNullableString(value.completedAt)
  ) {
    return null;
  }
  const item: RoadmapItemView = {
    treeId: value.treeId,
    areaName: value.areaName,
    targetNodeId: value.targetNodeId,
    targetLabel: value.targetLabel,
    targetAvailable: value.targetAvailable,
    tracking,
    priority: value.priority,
    status: value.status,
    startDate: value.startDate,
    targetDate: value.targetDate,
    owner,
    overdue: value.overdue,
    archived: value.archived,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: value.completedAt,
  };
  if (typeof value.targetReached === "boolean") {
    item.targetReached = value.targetReached;
  }
  return item;
}

function parseResponse(httpStatus: number, body: unknown): RoadmapItemsResult {
  if (isRecord(body) && Array.isArray(body.items) && typeof body.canEdit === "boolean" && typeof body.truncated === "boolean") {
    const items = body.items.map(parseItem);
    if (items.every((item): item is RoadmapItemView => item !== null)) {
      return { status: "ok", items, canEdit: body.canEdit, truncated: body.truncated };
    }
    return { status: "read_failed" };
  }
  if (httpStatus === 401) return { status: "unauthenticated" };
  if (httpStatus === 403) return { status: "forbidden" };
  return { status: "read_failed" };
}

/** Owner-selector entry (`GET /api/teams/[teamId]/assignable-members`). `memberRef` is the identity; never rendered. */
export interface AssignableMemberOption {
  memberRef: string;
  displayName: string | null;
  ordinal: number | null;
  isSelf: boolean;
}

export type AssignableMembersResult =
  | { status: "ok"; members: AssignableMemberOption[]; unavailableCount: number; truncated: boolean }
  | { status: "unauthenticated" | "forbidden" | "read_failed" };

export type RoadmapMutationError =
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
  | "already_planned"
  | "plan_archived"
  | "archived"
  | "persistence_failed"
  /** No usable response (network/parse): the write may or may not have happened. */
  | "request_failed";

/** Mutation outcome only. The response's derived presentation fields are deliberately dropped: callers refetch the canonical GET. */
export type RoadmapMutationResult = { ok: true } | { ok: false; error: RoadmapMutationError };

const MUTATION_ERRORS: readonly string[] = [
  "unauthenticated",
  "forbidden",
  "team_disabled",
  "invalid_request",
  "invalid_input",
  "target_not_ahead",
  "invalid_owner",
  "not_tracked",
  "tree_not_found",
  "not_found",
  "already_planned",
  "plan_archived",
  "archived",
  "persistence_failed",
];

function parseMutation(response: { ok: boolean; status: number }, body: unknown): RoadmapMutationResult {
  if (response.ok) return { ok: true };
  if (isRecord(body) && typeof body.error === "string" && MUTATION_ERRORS.includes(body.error)) {
    return { ok: false, error: body.error as RoadmapMutationError };
  }
  if (response.status === 401) return { ok: false, error: "unauthenticated" };
  if (response.status === 403) return { ok: false, error: "forbidden" };
  return { ok: false, error: "request_failed" };
}

function parseAssignable(httpStatus: number, body: unknown): AssignableMembersResult {
  if (
    isRecord(body) &&
    Array.isArray(body.members) &&
    typeof body.unavailableCount === "number" &&
    typeof body.truncated === "boolean"
  ) {
    const members: AssignableMemberOption[] = [];
    for (const m of body.members) {
      if (
        !isRecord(m) ||
        !isNonEmptyString(m.memberRef) ||
        !(m.displayName === null || isNonEmptyString(m.displayName)) ||
        !(m.ordinal === null || (Number.isInteger(m.ordinal) && (m.ordinal as number) > 0)) ||
        typeof m.isSelf !== "boolean"
      ) {
        return { status: "read_failed" };
      }
      members.push({
        memberRef: m.memberRef,
        displayName: m.displayName as string | null,
        ordinal: m.ordinal as number | null,
        isSelf: m.isSelf,
      });
    }
    return { status: "ok", members, unavailableCount: body.unavailableCount, truncated: body.truncated };
  }
  if (httpStatus === 401) return { status: "unauthenticated" };
  if (httpStatus === 403) return { status: "forbidden" };
  return { status: "read_failed" };
}

export interface RoadmapGateway {
  fetchRoadmapItems(idToken: string, teamId: string, includeArchived: boolean): Promise<RoadmapItemsResult>;
  fetchAssignableMembers(idToken: string, teamId: string): Promise<AssignableMembersResult>;
  createRoadmapItem(idToken: string, teamId: string, body: Record<string, unknown>): Promise<RoadmapMutationResult>;
  updateRoadmapItem(
    idToken: string,
    teamId: string,
    treeId: string,
    body: Record<string, unknown>,
  ): Promise<RoadmapMutationResult>;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function sendMutation(
  method: "POST" | "PATCH",
  url: string,
  idToken: string,
  body: Record<string, unknown>,
): Promise<RoadmapMutationResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseMutation(response, await readJson(response));
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

function getDefaultGateway(): RoadmapGateway {
  return {
    async fetchRoadmapItems(idToken, teamId, includeArchived) {
      try {
        const query = includeArchived ? "?archived=true" : "";
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/roadmap-items${query}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        return parseResponse(response.status, body);
      } catch {
        return { status: "read_failed" };
      }
    },
    async fetchAssignableMembers(idToken, teamId) {
      try {
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/assignable-members`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        return parseAssignable(response.status, await readJson(response));
      } catch {
        return { status: "read_failed" };
      }
    },
    createRoadmapItem(idToken, teamId, body) {
      return sendMutation("POST", `/api/teams/${encodeURIComponent(teamId)}/roadmap-items`, idToken, body);
    },
    updateRoadmapItem(idToken, teamId, treeId, body) {
      return sendMutation(
        "PATCH",
        `/api/teams/${encodeURIComponent(teamId)}/roadmap-items/${encodeURIComponent(treeId)}`,
        idToken,
        body,
      );
    },
  };
}

export interface FetchRoadmapItemsDeps {
  gateway?: RoadmapGateway;
}

export async function fetchRoadmapItems(
  idToken: string,
  teamId: string,
  options: { includeArchived?: boolean } = {},
  deps: FetchRoadmapItemsDeps = {},
): Promise<RoadmapItemsResult> {
  return (deps.gateway ?? getDefaultGateway()).fetchRoadmapItems(idToken, teamId, options.includeArchived === true);
}

export function fetchAssignableMembers(
  idToken: string,
  teamId: string,
  deps: FetchRoadmapItemsDeps = {},
): Promise<AssignableMembersResult> {
  return (deps.gateway ?? getDefaultGateway()).fetchAssignableMembers(idToken, teamId);
}

/** `POST /api/teams/[teamId]/roadmap-items` — body is exactly the approved create shape. */
export function createRoadmapItem(
  idToken: string,
  teamId: string,
  body: Record<string, unknown>,
  deps: FetchRoadmapItemsDeps = {},
): Promise<RoadmapMutationResult> {
  return (deps.gateway ?? getDefaultGateway()).createRoadmapItem(idToken, teamId, body);
}

/** `PATCH /api/teams/[teamId]/roadmap-items/[treeId]` — body is exactly the approved (minimal) patch shape. */
export function updateRoadmapItem(
  idToken: string,
  teamId: string,
  treeId: string,
  body: Record<string, unknown>,
  deps: FetchRoadmapItemsDeps = {},
): Promise<RoadmapMutationResult> {
  return (deps.gateway ?? getDefaultGateway()).updateRoadmapItem(idToken, teamId, treeId, body);
}
