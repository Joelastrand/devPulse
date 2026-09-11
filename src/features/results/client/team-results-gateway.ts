import type { PeriodAggregateResult } from "../domain/aggregation";

/**
 * The shape `GET /api/teams/[teamId]/results` returns (see
 * `app/api/teams/[teamId]/results/route.ts`). Never carries raw/individual
 * response data — only the aggregate figures `getTeamResults` already
 * computed server-side.
 */
export type TeamResultsFetchResult =
  | { status: "unauthenticated" | "forbidden" | "read_failed" }
  | {
      status: "ok";
      teamId: string;
      current: PeriodAggregateResult;
      trend: PeriodAggregateResult[];
    };

const KNOWN_ERROR_STATUSES = new Set(["unauthenticated", "forbidden", "read_failed"]);

/**
 * Narrows an untrusted parsed response body to `TeamResultsFetchResult`.
 * `GET /api/teams/[teamId]/results` uses non-2xx HTTP status codes for
 * meaningful responses (401/403/500), so — mirroring `dashboard-gateway.ts`
 * — this validates the body's own `status` field rather than the HTTP
 * status; only a malformed/unrecognized body falls back to `read_failed`.
 * Shape validation only; it never re-derives the authorization/aggregation
 * decisions `getTeamResults` already made server-side.
 */
function isTeamResultsFetchResult(value: unknown): value is TeamResultsFetchResult {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return false;
  }

  const { status } = value as { status: unknown };
  if (status === "ok") {
    return "teamId" in value && "current" in value && "trend" in value;
  }

  return typeof status === "string" && KNOWN_ERROR_STATUSES.has(status);
}

/**
 * The read seam this feature depends on, satisfied in production by a
 * `fetch` call and by an in-memory fake in tests (mirrors `DashboardGateway`).
 */
export interface TeamResultsGateway {
  fetchTeamResults(idToken: string, teamId: string): Promise<TeamResultsFetchResult>;
}

function getDefaultGateway(): TeamResultsGateway {
  return {
    async fetchTeamResults(idToken, teamId) {
      try {
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/results`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const parsed: unknown = await response.json();
        return isTeamResultsFetchResult(parsed) ? parsed : { status: "read_failed" };
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchTeamResultsDeps {
  gateway?: TeamResultsGateway;
}

/**
 * Fetches the signed-in caller's dashboard/trend data for one specific team
 * from the protected TASK-003 endpoint. `idToken` and `teamId` are the only
 * inputs — no authorization decision is made here; the server always
 * re-derives access via `authorizeTeamAccess` before any protected data is
 * returned.
 */
export async function fetchTeamResults(
  idToken: string,
  teamId: string,
  deps: FetchTeamResultsDeps = {},
): Promise<TeamResultsFetchResult> {
  const gateway = deps.gateway ?? getDefaultGateway();
  return gateway.fetchTeamResults(idToken, teamId);
}
