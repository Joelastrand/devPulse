import type { TeamOverviewEntry } from "../server/get-teams-overview";

export type { TeamOverviewEntry };

/**
 * The shape `GET /api/teams` returns (see `app/api/teams/route.ts`). Never
 * carries member/invitation/access-request identity data or any team's
 * result/aggregate data — only the caller's own overview.
 */
export type TeamsOverviewFetchResult =
  | { status: "unauthenticated" | "read_failed" }
  | { status: "ok"; teams: TeamOverviewEntry[] };

const KNOWN_ERROR_STATUSES = new Set(["unauthenticated", "read_failed"]);

const RELATIONSHIPS = new Set(["admin", "member", "request_pending", "request_rejected", "none"]);

function isTeamOverviewEntry(value: unknown): value is TeamOverviewEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { teamId, name, relationship } = value as Record<string, unknown>;
  return (
    typeof teamId === "string" &&
    typeof name === "string" &&
    typeof relationship === "string" &&
    RELATIONSHIPS.has(relationship)
  );
}

/**
 * Narrows an untrusted parsed response body to `TeamsOverviewFetchResult`.
 * Shape validation only — it never re-derives the relationship/authorization
 * decisions `getTeamsOverview` already made server-side.
 */
function isTeamsOverviewFetchResult(value: unknown): value is TeamsOverviewFetchResult {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.status === "ok") {
    return Array.isArray(record.teams) && record.teams.every(isTeamOverviewEntry);
  }

  return typeof record.status === "string" && KNOWN_ERROR_STATUSES.has(record.status);
}

/**
 * The read seam this feature depends on, satisfied in production by a
 * `fetch` call and by an in-memory fake in tests (mirrors `DashboardGateway`).
 */
export interface TeamsOverviewGateway {
  fetchTeamsOverview(idToken: string): Promise<TeamsOverviewFetchResult>;
}

function getDefaultGateway(): TeamsOverviewGateway {
  return {
    async fetchTeamsOverview(idToken) {
      try {
        const response = await fetch("/api/teams", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const parsed: unknown = await response.json();
        return isTeamsOverviewFetchResult(parsed) ? parsed : { status: "read_failed" };
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchTeamsOverviewDeps {
  gateway?: TeamsOverviewGateway;
}

/**
 * Fetches the signed-in caller's `/teams` overview. `idToken` is the only
 * input — no team relationship is ever client-supplied; every relationship
 * shown comes from `getTeamsOverview`'s own server-side computation.
 */
export async function fetchTeamsOverview(
  idToken: string,
  deps: FetchTeamsOverviewDeps = {},
): Promise<TeamsOverviewFetchResult> {
  const gateway = deps.gateway ?? getDefaultGateway();
  return gateway.fetchTeamsOverview(idToken);
}

/**
 * The shape `POST /api/teams/[teamId]/access-requests` returns (see
 * `app/api/teams/[teamId]/access-requests/route.ts`). This gateway only
 * forwards to that existing TASK-005 endpoint — it never re-implements the
 * eligibility/idempotency/state-machine logic that endpoint already owns.
 */
export type RequestTeamAccessResult =
  | { ok: true; outcome: "created" | "already_pending" | "already_authorized" }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "unverified"
        | "team_disabled"
        | "read_failed"
        | "persistence_failed"
        | "unknown";
    };

const KNOWN_OUTCOMES = new Set(["created", "already_pending", "already_authorized"]);
const KNOWN_REQUEST_ERRORS = new Set([
  "unauthenticated",
  "unverified",
  "team_disabled",
  "read_failed",
  "persistence_failed",
]);

function parseRequestTeamAccessResponse(status: number, body: unknown): RequestTeamAccessResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { outcome } = body as { outcome: unknown };
    if (typeof outcome === "string" && KNOWN_OUTCOMES.has(outcome)) {
      return { ok: true, outcome: outcome as "created" | "already_pending" | "already_authorized" };
    }
  }

  if (typeof body === "object" && body !== null) {
    const { error } = body as { error: unknown };
    if (typeof error === "string" && KNOWN_REQUEST_ERRORS.has(error)) {
      return {
        ok: false,
        error: error as
          | "unauthenticated"
          | "unverified"
          | "team_disabled"
          | "read_failed"
          | "persistence_failed",
      };
    }
  }

  return { ok: false, error: "unknown" };
}

export interface RequestTeamAccessGateway {
  requestTeamAccess(idToken: string, teamId: string): Promise<RequestTeamAccessResult>;
}

function getDefaultRequestAccessGateway(): RequestTeamAccessGateway {
  return {
    async requestTeamAccess(idToken, teamId) {
      try {
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/access-requests`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const parsed: unknown = await response.json();
        return parseRequestTeamAccessResponse(response.status, parsed);
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface RequestTeamAccessDeps {
  gateway?: RequestTeamAccessGateway;
}

/**
 * Submits a request-access action for one team via the existing TASK-005
 * endpoint (docs/features/team-management/SPEC.md — BR-23). Duplicates no
 * eligibility/idempotency logic client-side — every outcome
 * (`created`/`already_pending`/`already_authorized`) or failure is exactly
 * what the server already decided.
 */
export async function requestTeamAccess(
  idToken: string,
  teamId: string,
  deps: RequestTeamAccessDeps = {},
): Promise<RequestTeamAccessResult> {
  const gateway = deps.gateway ?? getDefaultRequestAccessGateway();
  return gateway.requestTeamAccess(idToken, teamId);
}
