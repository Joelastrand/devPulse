import { isSelfAssessedLevel, type SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { PROFILE_MODES, type ProfileMode } from "../domain/collaborative-profile";

/**
 * Browser gateway for the collaborative team profile (TASK-011 / BLK-1, BLK-2). Thin `fetch` wrappers over
 * `/api/teams/[teamId]/profile-settings` and `/api/teams/[teamId]/competence-areas`. Responses are rebuilt field by field,
 * so unexpected keys are dropped and a malformed body fails safe to `read_failed`. The server is the authorization
 * boundary; `canEdit` only shows or hides controls.
 */

export type CollaborativeReadStatus = "unauthenticated" | "forbidden" | "team_disabled" | "read_failed";

export interface CollaborativeLevel {
  readonly treeId: string;
  readonly level: SelfAssessedLevel;
}

export interface CollaborativeProfileState {
  readonly mode: ProfileMode;
  readonly levels: readonly CollaborativeLevel[];
}

export type CollaborativeProfileResult =
  | ({ status: "ok" } & CollaborativeProfileState)
  | { status: CollaborativeReadStatus };

export type CollaborativeWriteStatus =
  | "unauthenticated"
  | "forbidden"
  | "team_disabled"
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "write_failed";

export type CollaborativeWriteResult = { status: "ok" } | { status: CollaborativeWriteStatus };

export interface TeamAreaView {
  readonly treeId: string;
  readonly name: string | null;
  readonly status: "active" | "inactive" | "archived";
  readonly sortOrder: number;
}

export type TeamAreasResult =
  | { status: "ok"; areas: readonly TeamAreaView[]; canEdit: boolean; truncated: boolean }
  | { status: CollaborativeReadStatus };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function teamPath(teamId: string): string {
  return `/api/teams/${encodeURIComponent(teamId)}`;
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function readStatusFor(status: number): CollaborativeReadStatus {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 409) return "team_disabled";
  return "read_failed";
}

function writeStatusFor(status: number): CollaborativeWriteStatus {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 409) return "team_disabled";
  if (status === 400) return "invalid_input";
  if (status === 404) return "not_found";
  return "write_failed";
}

function parseLevel(value: unknown): CollaborativeLevel | null {
  if (!isRecord(value)) return null;
  if (typeof value.treeId !== "string" || value.treeId.length === 0 || !isSelfAssessedLevel(value.level)) return null;
  return { treeId: value.treeId, level: value.level };
}

function parseArea(value: unknown): TeamAreaView | null {
  if (!isRecord(value)) return null;
  const { treeId, name, status, sortOrder } = value;
  if (typeof treeId !== "string" || treeId.length === 0) return null;
  if (name !== null && typeof name !== "string") return null;
  if (status !== "active" && status !== "inactive" && status !== "archived") return null;
  if (typeof sortOrder !== "number" || !Number.isFinite(sortOrder)) return null;
  return { treeId, name, status, sortOrder };
}

/** Mode and team levels for a genuine member. Any unrecognised mode or level makes the whole response a read failure. */
export async function fetchCollaborativeProfile(token: string, teamId: string): Promise<CollaborativeProfileResult> {
  const response = await fetch(`${teamPath(teamId)}/profile-settings`, { headers: bearer(token) });
  if (!response.ok) return { status: readStatusFor(response.status) };
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || typeof body.mode !== "string" || !(PROFILE_MODES as readonly string[]).includes(body.mode)) {
    return { status: "read_failed" };
  }
  if (!Array.isArray(body.levels)) return { status: "read_failed" };
  const levels: CollaborativeLevel[] = [];
  for (const item of body.levels) {
    const level = parseLevel(item);
    if (level === null) return { status: "read_failed" };
    levels.push(level);
  }
  return { status: "ok", mode: body.mode as ProfileMode, levels };
}

/** Teamadmin only on the server. The client sends exactly `{ mode }`. */
export async function saveCollaborativeMode(token: string, teamId: string, mode: ProfileMode): Promise<CollaborativeWriteResult> {
  const response = await fetch(`${teamPath(teamId)}/profile-settings`, {
    method: "PUT",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  }).catch(() => null);
  if (response === null) return { status: "write_failed" };
  return response.ok ? { status: "ok" } : { status: writeStatusFor(response.status) };
}

/** Teamadmin only on the server. `level: null` clears the team value for the area. */
export async function saveCollaborativeLevel(
  token: string,
  teamId: string,
  treeId: string,
  level: SelfAssessedLevel | null,
): Promise<CollaborativeWriteResult> {
  const response = await fetch(`${teamPath(teamId)}/profile-settings/levels/${encodeURIComponent(treeId)}`, {
    method: "PUT",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify({ level }),
  }).catch(() => null);
  if (response === null) return { status: "write_failed" };
  return response.ok ? { status: "ok" } : { status: writeStatusFor(response.status) };
}

/** Team competence areas in order, names only. `canEdit` reflects the server's teamadmin check. */
export async function fetchTeamAreas(token: string, teamId: string): Promise<TeamAreasResult> {
  const response = await fetch(`${teamPath(teamId)}/competence-areas?archived=true`, { headers: bearer(token) });
  if (!response.ok) return { status: readStatusFor(response.status) };
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || !Array.isArray(body.areas) || typeof body.canEdit !== "boolean" || typeof body.truncated !== "boolean") {
    return { status: "read_failed" };
  }
  const areas: TeamAreaView[] = [];
  for (const item of body.areas) {
    const area = parseArea(item);
    if (area === null) return { status: "read_failed" };
    areas.push(area);
  }
  return { status: "ok", areas, canEdit: body.canEdit, truncated: body.truncated };
}

/** Teamadmin only: adds one catalog area to the team (it starts active). */
export async function assignTeamArea(token: string, teamId: string, treeId: string): Promise<CollaborativeWriteResult> {
  const response = await fetch(`${teamPath(teamId)}/competence-areas`, {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify({ treeId }),
  }).catch(() => null);
  if (response === null) return { status: "write_failed" };
  if (response.status === 409) return { status: "conflict" };
  return response.ok ? { status: "ok" } : { status: writeStatusFor(response.status) };
}

/** Teamadmin only: moves an area between active, inactive and archived. */
export async function setTeamAreaStatus(
  token: string,
  teamId: string,
  treeId: string,
  status: "active" | "inactive" | "archived",
): Promise<CollaborativeWriteResult> {
  const response = await fetch(`${teamPath(teamId)}/competence-areas/${encodeURIComponent(treeId)}`, {
    method: "PATCH",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  }).catch(() => null);
  if (response === null) return { status: "write_failed" };
  if (response.status === 409) return { status: "conflict" };
  return response.ok ? { status: "ok" } : { status: writeStatusFor(response.status) };
}
