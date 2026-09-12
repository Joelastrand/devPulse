/**
 * The shape `GET /api/me` returns (see `app/api/me/route.ts` /
 * `src/features/teams/server/get-own-admin-status.ts`). `read_failed`
 * covers a network error, a non-2xx status other than 401, or a malformed
 * body — the caller must still fail closed (never admin) exactly like an
 * explicit `unauthenticated`/non-admin result.
 */
export type OwnAdminStatusFetchResult =
  | { ok: true; isAdmin: boolean }
  | { ok: false; error: "unauthenticated" | "read_failed" };

function parseOwnAdminStatusResponse(status: number, body: unknown): OwnAdminStatusFetchResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { isAdmin } = body as { isAdmin: unknown };
    if (typeof isAdmin === "boolean") {
      return { ok: true, isAdmin };
    }
  }

  if (status === 401) {
    return { ok: false, error: "unauthenticated" };
  }

  return { ok: false, error: "read_failed" };
}

/**
 * The read seam this feature depends on, satisfied in production by a
 * `fetch` call and by an in-memory fake in tests (mirrors
 * `TeamsOverviewGateway`).
 */
export interface OwnAdminStatusGateway {
  fetchOwnAdminStatus(idToken: string): Promise<OwnAdminStatusFetchResult>;
}

function getDefaultGateway(): OwnAdminStatusGateway {
  return {
    async fetchOwnAdminStatus(idToken) {
      try {
        const response = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const parsed: unknown = await response.json();
        return parseOwnAdminStatusResponse(response.status, parsed);
      } catch {
        return { ok: false, error: "read_failed" };
      }
    },
  };
}

export interface FetchOwnAdminStatusDeps {
  gateway?: OwnAdminStatusGateway;
}

/**
 * Fetches the signed-in caller's own `isAdmin` boolean via TASK-004's
 * `GET /api/me`. `idToken` is the only input — this never re-derives admin
 * status client-side; every value shown comes from the server's own
 * `isAppAdmin` check.
 */
export async function fetchOwnAdminStatus(
  idToken: string,
  deps: FetchOwnAdminStatusDeps = {},
): Promise<OwnAdminStatusFetchResult> {
  const gateway = deps.gateway ?? getDefaultGateway();
  return gateway.fetchOwnAdminStatus(idToken);
}
