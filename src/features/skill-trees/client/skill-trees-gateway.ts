/**
 * Client gateway for the TASK-005 admin SkillTree catalog/creation/
 * correction endpoints (docs/features/team-skill-tree/SPEC.md — "API/DTO
 * contracts"). Each function is a thin `fetch` wrapper around one of the
 * three `/api/admin/skills` routes — no Firestore access, no SkillTree
 * business logic beyond response-shape validation lives here. Mirrors
 * `admin-teams-gateway.ts`'s established conventions: the Firebase ID token
 * is the caller's only input (admin status is always re-derived
 * server-side), every parser trusts the response body's own semantic shape
 * over the transport status code where the endpoint's contract calls for
 * it, and an unexpected/malformed shape fails safely to a generic
 * `"read_failed"`/`"unknown"` rather than fabricating or partially
 * rendering untrusted data.
 */

/** The client-facing shape of one SkillTree node — never `createdAt`/`createdBy`/`updatedAt`/`updatedBy`. */
export interface SkillTreeNodeView {
  nodeId: string;
  label: string;
  order: number;
}

/** The client-facing shape of one catalog SkillTree (see `list-skill-trees.ts`'s `SkillTreeView`). */
export interface AdminSkillTreeEntry {
  treeId: string;
  name: string;
  nodes: SkillTreeNodeView[];
}

function isSkillTreeNodeView(value: unknown): value is SkillTreeNodeView {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { nodeId, label, order } = value as Record<string, unknown>;
  return typeof nodeId === "string" && nodeId.length > 0 && typeof label === "string" && typeof order === "number";
}

function isAdminSkillTreeEntry(value: unknown): value is AdminSkillTreeEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { treeId, name, nodes } = value as Record<string, unknown>;
  return (
    typeof treeId === "string" &&
    treeId.length > 0 &&
    typeof name === "string" &&
    Array.isArray(nodes) &&
    nodes.every(isSkillTreeNodeView)
  );
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

// --- Catalog listing -------------------------------------------------------

export type FetchAdminSkillTreesResult =
  | { status: "ok"; trees: AdminSkillTreeEntry[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "read_failed" };

const KNOWN_LIST_ERRORS = new Set(["unauthenticated", "forbidden", "read_failed"]);

function parseFetchAdminSkillTreesResponse(body: unknown): FetchAdminSkillTreesResult {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.trees) && record.trees.every(isAdminSkillTreeEntry)) {
      return { status: "ok", trees: record.trees };
    }
    if (typeof record.error === "string" && KNOWN_LIST_ERRORS.has(record.error)) {
      return { status: record.error as "unauthenticated" | "forbidden" | "read_failed" };
    }
  }
  return { status: "read_failed" };
}

export interface FetchAdminSkillTreesGateway {
  fetchAdminSkillTrees(idToken: string): Promise<FetchAdminSkillTreesResult>;
}

function getDefaultFetchGateway(): FetchAdminSkillTreesGateway {
  return {
    async fetchAdminSkillTrees(idToken) {
      try {
        const response = await fetch("/api/admin/skills", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        return parseFetchAdminSkillTreesResponse(await parseJson(response));
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchAdminSkillTreesDeps {
  gateway?: FetchAdminSkillTreesGateway;
}

/** Fetches the bounded SkillTree catalog via the existing, unchanged `GET /api/admin/skills` endpoint. */
export async function fetchAdminSkillTrees(
  idToken: string,
  deps: FetchAdminSkillTreesDeps = {},
): Promise<FetchAdminSkillTreesResult> {
  const gateway = deps.gateway ?? getDefaultFetchGateway();
  return gateway.fetchAdminSkillTrees(idToken);
}

// --- Org-wide overview (TASK-002, docs/features/org-skill-progress-overview/
// SPEC.md) -------------------------------------------------------------
// A thin fetch wrapper around the new, admin-only, read-only `GET /api/admin/
// skills/overview` endpoint, which delegates entirely to
// `getOrgSkillProgressOverview`. No request body, no query parameter — the
// caller's Firebase ID token is the only input.

/** One tracking team's entry within a tree, exactly as `getOrgSkillProgressOverview` returns it — never `createdAt`/`createdBy`/`updatedAt`/`updatedBy` (BR-23/BR-24/BR-25). */
export interface OrgSkillProgressTeamEntryView {
  teamId: string;
  teamName: string;
  teamStatus: "active" | "disabled";
  currentNodeId: string | null;
}

/** One included `SkillTree` and its tracking teams, exactly as `getOrgSkillProgressOverview` returns it. */
export interface OrgSkillProgressTreeView {
  treeId: string;
  name: string;
  nodes: SkillTreeNodeView[];
  teams: OrgSkillProgressTeamEntryView[];
}

const ORG_SKILL_PROGRESS_TEAM_ENTRY_KEYS = new Set(["teamId", "teamName", "teamStatus", "currentNodeId"]);

/**
 * Structural check plus an exact-key check — a response object carrying any
 * field beyond the declared DTO shape (e.g. a stray `updatedBy`) is rejected
 * rather than passed through, reinforcing BR-23/BR-25 on the client side as
 * well as the server.
 */
function isOrgSkillProgressTeamEntryView(value: unknown): value is OrgSkillProgressTeamEntryView {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== ORG_SKILL_PROGRESS_TEAM_ENTRY_KEYS.size || !keys.every((key) => ORG_SKILL_PROGRESS_TEAM_ENTRY_KEYS.has(key))) {
    return false;
  }
  const { teamId, teamName, teamStatus, currentNodeId } = value as Record<string, unknown>;
  return (
    typeof teamId === "string" &&
    teamId.length > 0 &&
    typeof teamName === "string" &&
    (teamStatus === "active" || teamStatus === "disabled") &&
    (currentNodeId === null || typeof currentNodeId === "string")
  );
}

const ORG_SKILL_PROGRESS_TREE_VIEW_KEYS = new Set(["treeId", "name", "nodes", "teams"]);

function isOrgSkillProgressTreeView(value: unknown): value is OrgSkillProgressTreeView {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== ORG_SKILL_PROGRESS_TREE_VIEW_KEYS.size || !keys.every((key) => ORG_SKILL_PROGRESS_TREE_VIEW_KEYS.has(key))) {
    return false;
  }
  const { treeId, name, nodes, teams } = value as Record<string, unknown>;
  return (
    typeof treeId === "string" &&
    treeId.length > 0 &&
    typeof name === "string" &&
    Array.isArray(nodes) &&
    nodes.every(isSkillTreeNodeView) &&
    Array.isArray(teams) &&
    teams.every(isOrgSkillProgressTeamEntryView)
  );
}

export type FetchOrgSkillProgressOverviewResult =
  | { status: "ok"; trees: OrgSkillProgressTreeView[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "read_failed" };

const KNOWN_ORG_SKILL_PROGRESS_OVERVIEW_ERRORS = new Set(["unauthenticated", "forbidden", "read_failed"]);

function parseFetchOrgSkillProgressOverviewResponse(body: unknown): FetchOrgSkillProgressOverviewResult {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.trees) && record.trees.every(isOrgSkillProgressTreeView)) {
      return { status: "ok", trees: record.trees };
    }
    if (typeof record.error === "string" && KNOWN_ORG_SKILL_PROGRESS_OVERVIEW_ERRORS.has(record.error)) {
      return { status: record.error as "unauthenticated" | "forbidden" | "read_failed" };
    }
  }
  return { status: "read_failed" };
}

export interface FetchOrgSkillProgressOverviewGateway {
  fetchOrgSkillProgressOverview(idToken: string): Promise<FetchOrgSkillProgressOverviewResult>;
}

function getDefaultFetchOrgSkillProgressOverviewGateway(): FetchOrgSkillProgressOverviewGateway {
  return {
    async fetchOrgSkillProgressOverview(idToken) {
      try {
        const response = await fetch("/api/admin/skills/overview", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        return parseFetchOrgSkillProgressOverviewResponse(await parseJson(response));
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchOrgSkillProgressOverviewDeps {
  gateway?: FetchOrgSkillProgressOverviewGateway;
}

/**
 * Fetches the app-admin-only cross-team overview via the existing, unchanged
 * `GET /api/admin/skills/overview` endpoint — no Firestore access, no
 * member/team identity of any kind lives here; admin status is always
 * re-derived server-side by `getOrgSkillProgressOverview`.
 */
export async function fetchOrgSkillProgressOverview(
  idToken: string,
  deps: FetchOrgSkillProgressOverviewDeps = {},
): Promise<FetchOrgSkillProgressOverviewResult> {
  const gateway = deps.gateway ?? getDefaultFetchOrgSkillProgressOverviewGateway();
  return gateway.fetchOrgSkillProgressOverview(idToken);
}

// --- Creation ----------------------------------------------------------

export type CreateAdminSkillTreeResult =
  | { ok: true; treeId: string }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "invalid_input" | "persistence_failed" | "unknown";
    };

const KNOWN_CREATE_ERRORS = new Set(["unauthenticated", "forbidden", "invalid_input", "persistence_failed"]);

function parseCreateAdminSkillTreeResponse(status: number, body: unknown): CreateAdminSkillTreeResult {
  if (status === 201 && typeof body === "object" && body !== null) {
    const { treeId } = body as { treeId: unknown };
    if (typeof treeId === "string" && treeId.length > 0) {
      return { ok: true, treeId };
    }
  }

  if (typeof body === "object" && body !== null) {
    const { error } = body as { error: unknown };
    if (typeof error === "string" && KNOWN_CREATE_ERRORS.has(error)) {
      return {
        ok: false,
        error: error as "unauthenticated" | "forbidden" | "invalid_input" | "persistence_failed",
      };
    }
  }

  return { ok: false, error: "unknown" };
}

export interface CreateAdminSkillTreeGateway {
  createAdminSkillTree(
    idToken: string,
    name: string,
    nodeLabels: string[],
  ): Promise<CreateAdminSkillTreeResult>;
}

function getDefaultCreateGateway(): CreateAdminSkillTreeGateway {
  return {
    async createAdminSkillTree(idToken, name, nodeLabels) {
      try {
        const response = await fetch("/api/admin/skills", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ name, nodeLabels }),
        });
        return parseCreateAdminSkillTreeResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface CreateAdminSkillTreeDeps {
  gateway?: CreateAdminSkillTreeGateway;
}

/**
 * Creates a new SkillTree via the existing, unchanged `POST /api/admin/skills`
 * endpoint. The server assigns `treeId`/every node's `nodeId`; this gateway
 * only ever sends `{name, nodeLabels}` — never a `nodes` array of objects or
 * any audit field.
 */
export async function createAdminSkillTree(
  idToken: string,
  name: string,
  nodeLabels: string[],
  deps: CreateAdminSkillTreeDeps = {},
): Promise<CreateAdminSkillTreeResult> {
  const gateway = deps.gateway ?? getDefaultCreateGateway();
  return gateway.createAdminSkillTree(idToken, name, nodeLabels);
}

// --- Cosmetic correction -------------------------------------------------

export type CorrectAdminSkillTreeResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "forbidden"
        | "tree_not_found"
        | "invalid_input"
        | "node_count_mismatch"
        | "persistence_failed"
        | "unknown";
    };

const KNOWN_CORRECT_ERRORS = new Set([
  "unauthenticated",
  "forbidden",
  "tree_not_found",
  "invalid_input",
  "node_count_mismatch",
  "persistence_failed",
]);

function parseCorrectAdminSkillTreeResponse(status: number, body: unknown): CorrectAdminSkillTreeResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { ok } = body as { ok: unknown };
    if (ok === true) {
      return { ok: true };
    }
  }

  if (typeof body === "object" && body !== null) {
    const { error } = body as { error: unknown };
    if (typeof error === "string" && KNOWN_CORRECT_ERRORS.has(error)) {
      return {
        ok: false,
        error: error as
          | "unauthenticated"
          | "forbidden"
          | "tree_not_found"
          | "invalid_input"
          | "node_count_mismatch"
          | "persistence_failed",
      };
    }
  }

  return { ok: false, error: "unknown" };
}

export interface CorrectAdminSkillTreeGateway {
  correctAdminSkillTree(
    idToken: string,
    treeId: string,
    name: string,
    nodeLabels: string[],
  ): Promise<CorrectAdminSkillTreeResult>;
}

function getDefaultCorrectGateway(): CorrectAdminSkillTreeGateway {
  return {
    async correctAdminSkillTree(idToken, treeId, name, nodeLabels) {
      try {
        const response = await fetch(`/api/admin/skills/${encodeURIComponent(treeId)}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ name, nodeLabels }),
        });
        return parseCorrectAdminSkillTreeResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface CorrectAdminSkillTreeDeps {
  gateway?: CorrectAdminSkillTreeGateway;
}

/**
 * Cosmetically corrects an existing SkillTree's `name`/node `label` text via
 * the existing, unchanged `PATCH /api/admin/skills/[treeId]` endpoint. This
 * gateway only ever sends `{name, nodeLabels}` (a plain `string[]`) — it has
 * no parameter capable of expressing a `nodeId`, an insertion, a removal, a
 * reorder, or any audit/timestamp field; `treeId` is passed as the route
 * param, never inside the body.
 */
export async function correctAdminSkillTree(
  idToken: string,
  treeId: string,
  name: string,
  nodeLabels: string[],
  deps: CorrectAdminSkillTreeDeps = {},
): Promise<CorrectAdminSkillTreeResult> {
  const gateway = deps.gateway ?? getDefaultCorrectGateway();
  return gateway.correctAdminSkillTree(idToken, treeId, name, nodeLabels);
}

// --- Team tracking: start ------------------------------------------------
// TASK-006 (docs/features/team-skill-tree/SPEC.md — BR-27): thin fetch
// wrappers around the three `/api/admin/teams/[teamId]/skills...` endpoints.
// Each sends only its one whitelisted body field — never a `teamId`/`treeId`
// override (both travel as route params only) and never an audit field.

export type StartAdminTeamSkillTrackingResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "forbidden"
        | "tree_not_found"
        | "team_not_found"
        | "team_disabled"
        | "persistence_failed"
        | "unknown";
    };

const KNOWN_START_ERRORS = new Set([
  "unauthenticated",
  "forbidden",
  "tree_not_found",
  "team_not_found",
  "team_disabled",
  "persistence_failed",
]);

function parseStartAdminTeamSkillTrackingResponse(
  status: number,
  body: unknown,
): StartAdminTeamSkillTrackingResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { ok } = body as { ok: unknown };
    if (ok === true) {
      return { ok: true };
    }
  }

  if (typeof body === "object" && body !== null) {
    const { error } = body as { error: unknown };
    if (typeof error === "string" && KNOWN_START_ERRORS.has(error)) {
      return {
        ok: false,
        error: error as
          | "unauthenticated"
          | "forbidden"
          | "tree_not_found"
          | "team_not_found"
          | "team_disabled"
          | "persistence_failed",
      };
    }
  }

  return { ok: false, error: "unknown" };
}

export interface StartAdminTeamSkillTrackingGateway {
  startAdminTeamSkillTracking(
    idToken: string,
    teamId: string,
    treeId: string,
  ): Promise<StartAdminTeamSkillTrackingResult>;
}

function getDefaultStartGateway(): StartAdminTeamSkillTrackingGateway {
  return {
    async startAdminTeamSkillTracking(idToken, teamId, treeId) {
      try {
        const response = await fetch(`/api/admin/teams/${encodeURIComponent(teamId)}/skills`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ treeId }),
        });
        return parseStartAdminTeamSkillTrackingResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface StartAdminTeamSkillTrackingDeps {
  gateway?: StartAdminTeamSkillTrackingGateway;
}

/**
 * Starts tracking an existing SkillTree for a team via `POST /api/admin/
 * teams/[teamId]/skills`. This gateway only ever sends `{treeId}` — `teamId`
 * travels as the route param, never inside the body.
 */
export async function startAdminTeamSkillTracking(
  idToken: string,
  teamId: string,
  treeId: string,
  deps: StartAdminTeamSkillTrackingDeps = {},
): Promise<StartAdminTeamSkillTrackingResult> {
  const gateway = deps.gateway ?? getDefaultStartGateway();
  return gateway.startAdminTeamSkillTracking(idToken, teamId, treeId);
}

// --- Team tracking: update -------------------------------------------------

export type UpdateAdminTeamSkillProgressResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "forbidden"
        | "not_tracked"
        | "tree_not_found"
        | "invalid_input"
        | "persistence_failed"
        | "unknown";
    };

const KNOWN_UPDATE_ERRORS = new Set([
  "unauthenticated",
  "forbidden",
  "not_tracked",
  "tree_not_found",
  "invalid_input",
  "persistence_failed",
]);

function parseUpdateAdminTeamSkillProgressResponse(
  status: number,
  body: unknown,
): UpdateAdminTeamSkillProgressResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { ok } = body as { ok: unknown };
    if (ok === true) {
      return { ok: true };
    }
  }

  if (typeof body === "object" && body !== null) {
    const { error } = body as { error: unknown };
    if (typeof error === "string" && KNOWN_UPDATE_ERRORS.has(error)) {
      return {
        ok: false,
        error: error as
          | "unauthenticated"
          | "forbidden"
          | "not_tracked"
          | "tree_not_found"
          | "invalid_input"
          | "persistence_failed",
      };
    }
  }

  return { ok: false, error: "unknown" };
}

export interface UpdateAdminTeamSkillProgressGateway {
  updateAdminTeamSkillProgress(
    idToken: string,
    teamId: string,
    treeId: string,
    nodeId: string,
  ): Promise<UpdateAdminTeamSkillProgressResult>;
}

function getDefaultUpdateGateway(): UpdateAdminTeamSkillProgressGateway {
  return {
    async updateAdminTeamSkillProgress(idToken, teamId, treeId, nodeId) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/skills/${encodeURIComponent(treeId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${idToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ nodeId }),
          },
        );
        return parseUpdateAdminTeamSkillProgressResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface UpdateAdminTeamSkillProgressDeps {
  gateway?: UpdateAdminTeamSkillProgressGateway;
}

/**
 * Sets a tracked tree's current stage for a team via `PATCH /api/admin/
 * teams/[teamId]/skills/[treeId]`. This gateway only ever sends `{nodeId}` —
 * `teamId`/`treeId` travel as route params, never inside the body.
 */
export async function updateAdminTeamSkillProgress(
  idToken: string,
  teamId: string,
  treeId: string,
  nodeId: string,
  deps: UpdateAdminTeamSkillProgressDeps = {},
): Promise<UpdateAdminTeamSkillProgressResult> {
  const gateway = deps.gateway ?? getDefaultUpdateGateway();
  return gateway.updateAdminTeamSkillProgress(idToken, teamId, treeId, nodeId);
}

// --- Team tracking: stop ----------------------------------------------------

export type StopAdminTeamSkillTrackingResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "forbidden" | "persistence_failed" | "unknown" };

const KNOWN_STOP_ERRORS = new Set(["unauthenticated", "forbidden", "persistence_failed"]);

function parseStopAdminTeamSkillTrackingResponse(
  status: number,
  body: unknown,
): StopAdminTeamSkillTrackingResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { ok } = body as { ok: unknown };
    if (ok === true) {
      return { ok: true };
    }
  }

  if (typeof body === "object" && body !== null) {
    const { error } = body as { error: unknown };
    if (typeof error === "string" && KNOWN_STOP_ERRORS.has(error)) {
      return { ok: false, error: error as "unauthenticated" | "forbidden" | "persistence_failed" };
    }
  }

  return { ok: false, error: "unknown" };
}

export interface StopAdminTeamSkillTrackingGateway {
  stopAdminTeamSkillTracking(
    idToken: string,
    teamId: string,
    treeId: string,
  ): Promise<StopAdminTeamSkillTrackingResult>;
}

function getDefaultStopGateway(): StopAdminTeamSkillTrackingGateway {
  return {
    async stopAdminTeamSkillTracking(idToken, teamId, treeId) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/skills/${encodeURIComponent(treeId)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${idToken}` },
          },
        );
        return parseStopAdminTeamSkillTrackingResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface StopAdminTeamSkillTrackingDeps {
  gateway?: StopAdminTeamSkillTrackingGateway;
}

/**
 * Stops tracking a SkillTree for a team via `DELETE /api/admin/teams/
 * [teamId]/skills/[treeId]`. No body — `teamId`/`treeId` travel as route
 * params only.
 */
export async function stopAdminTeamSkillTracking(
  idToken: string,
  teamId: string,
  treeId: string,
  deps: StopAdminTeamSkillTrackingDeps = {},
): Promise<StopAdminTeamSkillTrackingResult> {
  const gateway = deps.gateway ?? getDefaultStopGateway();
  return gateway.stopAdminTeamSkillTracking(idToken, teamId, treeId);
}

// --- Team-facing read (TASK-007) -------------------------------------------
// docs/features/team-skill-tree/SPEC.md — BR-28 through BR-30: a thin fetch
// wrapper around the finalized, unchanged `GET /api/teams/[teamId]/skills`
// endpoint, which itself delegates entirely to `getTeamSkillProgress`. This
// gateway sends no body and never carries `createdBy`/`updatedBy`/
// `createdAt`/`updatedAt` — the response shape it accepts has no field for
// any of them.

/** One tracked tree's team-facing, read-only view — never `createdAt`/`createdBy`/`updatedAt`/`updatedBy` (BR-22). */
export interface TeamSkillView {
  treeId: string;
  name: string;
  nodes: SkillTreeNodeView[];
  currentNodeId: string | null;
}

function isTeamSkillView(value: unknown): value is TeamSkillView {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { treeId, name, nodes, currentNodeId } = value as Record<string, unknown>;
  return (
    typeof treeId === "string" &&
    treeId.length > 0 &&
    typeof name === "string" &&
    Array.isArray(nodes) &&
    nodes.every(isSkillTreeNodeView) &&
    (currentNodeId === null || typeof currentNodeId === "string")
  );
}

export type FetchTeamSkillsResult =
  | { status: "ok"; skills: TeamSkillView[]; canReportProgress: boolean }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "read_failed" };

const KNOWN_TEAM_SKILLS_ERRORS = new Set(["unauthenticated", "forbidden", "read_failed"]);

/**
 * Requires `canReportProgress` to be strictly boolean (docs/features/
 * skill-progress-self-report/SPEC.md — "Permission-UI correction"). A
 * missing or non-boolean value fails the whole response closed to
 * `read_failed` rather than defaulting to `true`/permissively enabling
 * mutation controls, or silently defaulting to `false` while still trusting
 * the rest of an otherwise-malformed response — mirrors this gateway's
 * existing all-or-nothing shape validation for `skills` itself.
 */
function parseFetchTeamSkillsResponse(body: unknown): FetchTeamSkillsResult {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (
      record.status === "ok" &&
      Array.isArray(record.skills) &&
      record.skills.every(isTeamSkillView) &&
      typeof record.canReportProgress === "boolean"
    ) {
      return { status: "ok", skills: record.skills, canReportProgress: record.canReportProgress };
    }
    if (typeof record.status === "string" && KNOWN_TEAM_SKILLS_ERRORS.has(record.status)) {
      return { status: record.status as "unauthenticated" | "forbidden" | "read_failed" };
    }
  }
  return { status: "read_failed" };
}

export interface FetchTeamSkillsGateway {
  fetchTeamSkills(idToken: string, teamId: string): Promise<FetchTeamSkillsResult>;
}

function getDefaultFetchTeamSkillsGateway(): FetchTeamSkillsGateway {
  return {
    async fetchTeamSkills(idToken, teamId) {
      try {
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/skills`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        return parseFetchTeamSkillsResponse(await parseJson(response));
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchTeamSkillsDeps {
  gateway?: FetchTeamSkillsGateway;
}

/**
 * Fetches `teamId`'s full read-only skill-tracking state via the existing,
 * unchanged `GET /api/teams/[teamId]/skills` endpoint — no Firestore access,
 * no authorization decision of any kind lives here (`getTeamSkillProgress`
 * already guarantees a non-member/non-admin never receives this data).
 */
export async function fetchTeamSkills(
  idToken: string,
  teamId: string,
  deps: FetchTeamSkillsDeps = {},
): Promise<FetchTeamSkillsResult> {
  const gateway = deps.gateway ?? getDefaultFetchTeamSkillsGateway();
  return gateway.fetchTeamSkills(idToken, teamId);
}

// --- Team-facing self-report (TASK-002) ------------------------------------
// docs/features/skill-progress-self-report/SPEC.md — BR-14: a thin fetch
// wrapper around the new `PATCH /api/teams/[teamId]/skills/[treeId]`
// endpoint, which delegates entirely to `reportTeamSkillProgress`. This
// gateway only ever sends `{nodeId}` — `teamId`/`treeId` travel as route
// params, never inside the body, and no `updatedBy`/audit field of any kind
// is ever exposed to or accepted from the client (BR-5's server-only
// posture is preserved; this gateway has no parameter capable of
// expressing one).

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
        | "persistence_failed"
        | "unknown";
    };

const KNOWN_REPORT_ERRORS = new Set([
  "unauthenticated",
  "forbidden",
  "team_disabled",
  "not_tracked",
  "tree_not_found",
  "invalid_input",
  "persistence_failed",
]);

function parseReportTeamSkillProgressResponse(status: number, body: unknown): ReportTeamSkillProgressResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { ok } = body as { ok: unknown };
    if (ok === true) {
      return { ok: true };
    }
  }

  if (typeof body === "object" && body !== null) {
    const { error } = body as { error: unknown };
    if (typeof error === "string" && KNOWN_REPORT_ERRORS.has(error)) {
      return {
        ok: false,
        error: error as
          | "unauthenticated"
          | "forbidden"
          | "team_disabled"
          | "not_tracked"
          | "tree_not_found"
          | "invalid_input"
          | "persistence_failed",
      };
    }
  }

  return { ok: false, error: "unknown" };
}

export interface ReportTeamSkillProgressGateway {
  reportTeamSkillProgress(
    idToken: string,
    teamId: string,
    treeId: string,
    nodeId: string,
  ): Promise<ReportTeamSkillProgressResult>;
}

function getDefaultReportGateway(): ReportTeamSkillProgressGateway {
  return {
    async reportTeamSkillProgress(idToken, teamId, treeId, nodeId) {
      try {
        const response = await fetch(
          `/api/teams/${encodeURIComponent(teamId)}/skills/${encodeURIComponent(treeId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${idToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ nodeId }),
          },
        );
        return parseReportTeamSkillProgressResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface ReportTeamSkillProgressDeps {
  gateway?: ReportTeamSkillProgressGateway;
}

/**
 * Reports a real team member's own stage on an already-tracked tree via
 * `PATCH /api/teams/[teamId]/skills/[treeId]` (docs/features/
 * skill-progress-self-report/SPEC.md — BR-14). This gateway only ever sends
 * `{nodeId}` — `teamId`/`treeId` travel as route params, never inside the
 * body — and never surfaces `updatedBy` or any other audit identity in
 * either direction: the caller's uid is derived entirely server-side
 * (`.claude/rules/security.md`).
 */
export async function reportTeamSkillProgress(
  idToken: string,
  teamId: string,
  treeId: string,
  nodeId: string,
  deps: ReportTeamSkillProgressDeps = {},
): Promise<ReportTeamSkillProgressResult> {
  const gateway = deps.gateway ?? getDefaultReportGateway();
  return gateway.reportTeamSkillProgress(idToken, teamId, treeId, nodeId);
}
