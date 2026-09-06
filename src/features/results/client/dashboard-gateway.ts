import type { PeriodAggregateResult } from "../domain/aggregation";

/**
 * The shape `GET /api/results` returns (see `app/api/results/route.ts`).
 * Never carries raw/individual response data — only the aggregate figures
 * `getDashboard` already computed server-side.
 */
export type DashboardFetchResult =
  | { status: "unauthenticated" | "no_team" | "read_failed" }
  | {
      status: "ok";
      teamId: string;
      current: PeriodAggregateResult;
      trend: PeriodAggregateResult[];
    };

const KNOWN_ERROR_STATUSES = new Set(["unauthenticated", "no_team", "read_failed"]);

/**
 * Narrows an untrusted parsed response body to `DashboardFetchResult`.
 * `GET /api/results` uses non-2xx HTTP status codes for meaningful
 * responses (401 for `unauthenticated`, 500 for `read_failed`), so this
 * validates the body's own `status` field rather than the HTTP status —
 * only a malformed/unrecognized body falls back to `read_failed`. This is
 * shape validation only; it never re-derives or duplicates the
 * authorization/aggregation decisions `getDashboard` already made
 * server-side.
 */
function isDashboardFetchResult(value: unknown): value is DashboardFetchResult {
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
 * `fetch` call and by an in-memory fake in tests (mirrors `AuthGateway`).
 */
export interface DashboardGateway {
  fetchDashboard(idToken: string): Promise<DashboardFetchResult>;
}

function getDefaultGateway(): DashboardGateway {
  return {
    async fetchDashboard(idToken) {
      try {
        const response = await fetch("/api/results", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const parsed: unknown = await response.json();
        return isDashboardFetchResult(parsed) ? parsed : { status: "read_failed" };
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchDashboardDeps {
  gateway?: DashboardGateway;
}

/**
 * Fetches the signed-in caller's dashboard/trend data from the protected
 * endpoint. `idToken` is the only input — no team or period is ever
 * client-supplied (BR-4/BR-10 are enforced server-side; this is purely a
 * thin read seam for the UI).
 */
export async function fetchDashboard(
  idToken: string,
  deps: FetchDashboardDeps = {},
): Promise<DashboardFetchResult> {
  const gateway = deps.gateway ?? getDefaultGateway();
  return gateway.fetchDashboard(idToken);
}
