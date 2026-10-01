/**
 * Client gateway for the member-facing team roster (docs/features/member-
 * identity-and-team-roles/SPEC.md — BR-8 through BR-15, BR-31): a thin
 * `fetch` wrapper around `GET /api/teams/[teamId]/members`. The public entry
 * shape is exactly `{displayName, isLead, isSelf}` — the parser rebuilds each
 * entry from those three fields only, so anything else a response might
 * carry is dropped rather than passed to the UI. The client parser is not
 * the privacy boundary (the server is); a malformed response fails safe to
 * `read_failed` instead of rendering arbitrary fields.
 */

export interface TeamRosterEntryView {
  displayName: string | null;
  isLead: boolean;
  isSelf: boolean;
}

export type FetchTeamRosterResult =
  | { status: "ok"; members: TeamRosterEntryView[]; truncated: boolean }
  | { status: "unauthenticated" | "forbidden" | "read_failed" };

function parseEntry(value: unknown): TeamRosterEntryView | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { displayName, isLead, isSelf } = value as Record<string, unknown>;
  const nameOk = displayName === null || (typeof displayName === "string" && displayName.length > 0);
  if (!nameOk || typeof isLead !== "boolean" || typeof isSelf !== "boolean") {
    return null;
  }
  return { displayName: displayName as string | null, isLead, isSelf };
}

function parseResponse(httpStatus: number, body: unknown): FetchTeamRosterResult {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;

    if (record.status === "ok" && Array.isArray(record.members) && typeof record.truncated === "boolean") {
      const members = record.members.map(parseEntry);
      if (members.every((member): member is TeamRosterEntryView => member !== null)) {
        return { status: "ok", members, truncated: record.truncated };
      }
      return { status: "read_failed" };
    }
    if (record.status === "unauthenticated" || record.status === "forbidden") {
      return { status: record.status };
    }
  }

  if (httpStatus === 401) return { status: "unauthenticated" };
  if (httpStatus === 403) return { status: "forbidden" };
  return { status: "read_failed" };
}

export interface TeamRosterGateway {
  fetchTeamRoster(idToken: string, teamId: string): Promise<FetchTeamRosterResult>;
}

function getDefaultGateway(): TeamRosterGateway {
  return {
    async fetchTeamRoster(idToken, teamId) {
      try {
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/members`, {
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
  };
}

export interface FetchTeamRosterDeps {
  gateway?: TeamRosterGateway;
}

export async function fetchTeamRoster(
  idToken: string,
  teamId: string,
  deps: FetchTeamRosterDeps = {},
): Promise<FetchTeamRosterResult> {
  return (deps.gateway ?? getDefaultGateway()).fetchTeamRoster(idToken, teamId);
}
