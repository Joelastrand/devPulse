import type { TeamStatus } from "../domain/team";

const KNOWN_TEAM_STATUSES = new Set<TeamStatus>(["active", "disabled"]);

/**
 * The minimal, non-sensitive fields the admin teams UI needs — never the
 * full `Team` document's `createdAt`/`createdBy` (TASK-009: "do not expose
 * ... createdBy unless SPEC requires it"), even though `GET /api/admin/teams`
 * (TASK-001, unchanged) happens to include them on the wire.
 */
export interface AdminTeamListEntry {
  teamId: string;
  name: string;
  status: TeamStatus;
}

function isAdminTeamListEntry(value: unknown): value is AdminTeamListEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { teamId, name, status } = value as Record<string, unknown>;
  return (
    typeof teamId === "string" &&
    teamId.length > 0 &&
    typeof name === "string" &&
    typeof status === "string" &&
    KNOWN_TEAM_STATUSES.has(status as TeamStatus)
  );
}

/**
 * The shape `GET /api/admin/teams` returns (see `app/api/admin/teams/route.ts`,
 * `list-teams.ts`). Never carries member/invitation/access-request data or
 * any team's results — only the admin-visible catalog (every team,
 * including `disabled` ones).
 */
export type AdminTeamsFetchResult =
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "read_failed" }
  | { status: "ok"; teams: AdminTeamListEntry[] };

const KNOWN_LIST_ERRORS = new Set(["unauthenticated", "forbidden", "read_failed"]);

/**
 * Narrows an untrusted parsed response body to `AdminTeamsFetchResult`.
 * This endpoint's contract is `{teams: Team[]}` on success or `{error}` on
 * failure (not the `{status}` shape `dashboard-gateway.ts`/
 * `team-results-gateway.ts` use) — validated here regardless of HTTP status,
 * matching those gateways' established principle of trusting the semantic
 * body over the transport status code. Any other body shape — including a
 * `teams` array containing a malformed entry — fails safely to
 * `"read_failed"`, never a partial or fabricated list.
 */
function parseAdminTeamsResponse(body: unknown): AdminTeamsFetchResult {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.teams) && record.teams.every(isAdminTeamListEntry)) {
      // Only the approved minimal fields cross into the app's data model —
      // `createdAt`/`createdBy` on the wire (TASK-001's unchanged `Team`
      // shape) are dropped here, not merely left unrendered.
      const teams: AdminTeamListEntry[] = record.teams.map(({ teamId, name, status }) => ({
        teamId,
        name,
        status,
      }));
      return { status: "ok", teams };
    }
    if (typeof record.error === "string" && KNOWN_LIST_ERRORS.has(record.error)) {
      return { status: record.error as "unauthenticated" | "forbidden" | "read_failed" };
    }
  }
  return { status: "read_failed" };
}

export interface AdminTeamsGateway {
  fetchAdminTeams(idToken: string): Promise<AdminTeamsFetchResult>;
}

function getDefaultGateway(): AdminTeamsGateway {
  return {
    async fetchAdminTeams(idToken) {
      try {
        const response = await fetch("/api/admin/teams", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const parsed: unknown = await response.json();
        return parseAdminTeamsResponse(parsed);
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchAdminTeamsDeps {
  gateway?: AdminTeamsGateway;
}

/**
 * Fetches the full admin-visible team catalog (active and disabled) from
 * the existing, unchanged TASK-001 endpoint. `idToken` is the only input —
 * admin status is never client-supplied; `listTeams`/`requireAppAdmin`
 * re-derive it server-side on every call.
 */
export async function fetchAdminTeams(
  idToken: string,
  deps: FetchAdminTeamsDeps = {},
): Promise<AdminTeamsFetchResult> {
  const gateway = deps.gateway ?? getDefaultGateway();
  return gateway.fetchAdminTeams(idToken);
}

/**
 * The shape `POST /api/admin/teams` returns (see `create-team.ts`). This
 * gateway only forwards to that existing TASK-001 endpoint — it never
 * re-implements admin authorization or `teamId` generation client-side.
 */
export type CreateAdminTeamResult =
  | { ok: true; teamId: string }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "invalid_name" | "persistence_failed" | "unknown";
    };

const KNOWN_CREATE_ERRORS = new Set([
  "unauthenticated",
  "forbidden",
  "invalid_name",
  "persistence_failed",
]);

function parseCreateAdminTeamResponse(status: number, body: unknown): CreateAdminTeamResult {
  if (status === 201 && typeof body === "object" && body !== null) {
    const { teamId } = body as { teamId: unknown };
    if (typeof teamId === "string" && teamId.length > 0) {
      return { ok: true, teamId };
    }
  }

  if (typeof body === "object" && body !== null) {
    const { error } = body as { error: unknown };
    if (typeof error === "string" && KNOWN_CREATE_ERRORS.has(error)) {
      return {
        ok: false,
        error: error as "unauthenticated" | "forbidden" | "invalid_name" | "persistence_failed",
      };
    }
  }

  return { ok: false, error: "unknown" };
}

export interface CreateAdminTeamGateway {
  createAdminTeam(idToken: string, name: string): Promise<CreateAdminTeamResult>;
}

function getDefaultCreateGateway(): CreateAdminTeamGateway {
  return {
    async createAdminTeam(idToken, name) {
      try {
        const response = await fetch("/api/admin/teams", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ name }),
        });
        const parsed: unknown = await response.json();
        return parseCreateAdminTeamResponse(response.status, parsed);
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface CreateAdminTeamDeps {
  gateway?: CreateAdminTeamGateway;
}

/**
 * Creates a new `active` team via the existing, unchanged TASK-001
 * endpoint. The server assigns the opaque `teamId`; nothing here fabricates
 * or predicts it (BR-1).
 */
export async function createAdminTeam(
  idToken: string,
  name: string,
  deps: CreateAdminTeamDeps = {},
): Promise<CreateAdminTeamResult> {
  const gateway = deps.gateway ?? getDefaultCreateGateway();
  return gateway.createAdminTeam(idToken, name);
}

/**
 * The shape `PATCH /api/admin/teams/[teamId]` returns (see
 * `set-team-status.ts`). This gateway only forwards to that existing
 * TASK-001 endpoint.
 */
export type SetAdminTeamStatusResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "forbidden" | "persistence_failed" | "unknown" };

const KNOWN_STATUS_ERRORS = new Set(["unauthenticated", "forbidden", "persistence_failed"]);

function parseSetAdminTeamStatusResponse(status: number, body: unknown): SetAdminTeamStatusResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { ok } = body as { ok: unknown };
    if (ok === true) {
      return { ok: true };
    }
  }

  if (typeof body === "object" && body !== null) {
    const { error } = body as { error: unknown };
    if (typeof error === "string" && KNOWN_STATUS_ERRORS.has(error)) {
      return {
        ok: false,
        error: error as "unauthenticated" | "forbidden" | "persistence_failed",
      };
    }
  }

  return { ok: false, error: "unknown" };
}

export interface SetAdminTeamStatusGateway {
  setAdminTeamStatus(
    idToken: string,
    teamId: string,
    status: TeamStatus,
  ): Promise<SetAdminTeamStatusResult>;
}

function getDefaultSetStatusGateway(): SetAdminTeamStatusGateway {
  return {
    async setAdminTeamStatus(idToken, teamId, status) {
      try {
        const response = await fetch(`/api/admin/teams/${encodeURIComponent(teamId)}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ status }),
        });
        const parsed: unknown = await response.json();
        return parseSetAdminTeamStatusResponse(response.status, parsed);
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface SetAdminTeamStatusDeps {
  gateway?: SetAdminTeamStatusGateway;
}

/**
 * Disables or re-enables a team via the existing, unchanged TASK-001
 * endpoint. Never deletes the team or any survey data (BR-4) — this only
 * ever sends the new `status` value; the server re-derives admin
 * authorization on every call.
 */
export async function setAdminTeamStatus(
  idToken: string,
  teamId: string,
  status: TeamStatus,
  deps: SetAdminTeamStatusDeps = {},
): Promise<SetAdminTeamStatusResult> {
  const gateway = deps.gateway ?? getDefaultSetStatusGateway();
  return gateway.setAdminTeamStatus(idToken, teamId, status);
}
