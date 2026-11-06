/**
 * Client gateway for team visibility (docs/features/teamadmin-and-team-visibility/SPEC.md): thin `fetch` wrappers around
 * `GET`/`PUT /api/teams/[teamId]/visibility` and `GET /api/public/teams/[teamId]`. Responses are parsed to fixed shapes
 * and anything malformed fails to `read_failed`. The server decides every permission; `canAdminister` only hides controls.
 */

export type TeamVisibilityValue = "private" | "public";

export type FetchTeamVisibilityResult =
  | { status: "ok"; visibility: TeamVisibilityValue; canAdminister: boolean }
  | { status: "unauthenticated" | "forbidden" | "not_found" | "read_failed" };

export type SaveTeamVisibilityResult =
  | { status: "ok"; visibility: TeamVisibilityValue; changed: boolean }
  | { status: "unauthenticated" | "forbidden" | "not_found" | "team_disabled" | "erasure_in_progress" | "read_failed" };

export type FetchPublicTeamResult =
  | { status: "ok"; team: { teamId: string; name: string } }
  | { status: "not_found" | "read_failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVisibility(value: unknown): value is TeamVisibilityValue {
  return value === "private" || value === "public";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorStatusOf(body: unknown): string | undefined {
  return isRecord(body) && typeof body.error === "string" ? body.error : undefined;
}

export async function fetchTeamVisibility(token: string, teamId: string): Promise<FetchTeamVisibilityResult> {
  let response: Response;
  try {
    response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/visibility`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { status: "read_failed" };
  }
  const body = await readJson(response);
  if (response.ok && isRecord(body) && isVisibility(body.visibility) && typeof body.canAdminister === "boolean") {
    return { status: "ok", visibility: body.visibility, canAdminister: body.canAdminister };
  }
  return { status: refusalStatus(errorStatusOf(body), response.status) };
}

export async function saveTeamVisibility(
  token: string,
  teamId: string,
  visibility: TeamVisibilityValue,
): Promise<SaveTeamVisibilityResult> {
  let response: Response;
  try {
    response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/visibility`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ visibility }),
    });
  } catch {
    return { status: "read_failed" };
  }
  const body = await readJson(response);
  if (response.ok && isRecord(body) && isVisibility(body.visibility) && typeof body.changed === "boolean") {
    return { status: "ok", visibility: body.visibility, changed: body.changed };
  }
  const error = errorStatusOf(body);
  if (error === "team_disabled" || error === "erasure_in_progress") return { status: error };
  return { status: refusalStatus(error, response.status) };
}

export async function fetchPublicTeam(teamId: string): Promise<FetchPublicTeamResult> {
  let response: Response;
  try {
    response = await fetch(`/api/public/teams/${encodeURIComponent(teamId)}`, { cache: "no-store" });
  } catch {
    return { status: "read_failed" };
  }
  const body = await readJson(response);
  if (response.ok && isRecord(body) && isRecord(body.team)) {
    const { teamId: id, name } = body.team;
    if (typeof id === "string" && typeof name === "string" && name.length > 0) {
      return { status: "ok", team: { teamId: id, name } };
    }
    return { status: "read_failed" };
  }
  return { status: response.status === 404 ? "not_found" : "read_failed" };
}

function refusalStatus(error: string | undefined, httpStatus: number) {
  if (error === "unauthenticated" || httpStatus === 401) return "unauthenticated" as const;
  if (error === "forbidden" || httpStatus === 403) return "forbidden" as const;
  if (error === "not_found" || httpStatus === 404) return "not_found" as const;
  return "read_failed" as const;
}
