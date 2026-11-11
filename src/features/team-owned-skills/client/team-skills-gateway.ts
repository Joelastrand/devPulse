import type { TeamSkillGuidance, TeamSkillLevel } from "../domain/team-skill";

/**
 * Browser gateway for team-owned skills (docs/features/team-owned-skills/SPEC.md). Thin `fetch` wrappers over
 * `/api/teams/[teamId]/team-skills`. Responses are rebuilt field by field; a malformed body fails safe to
 * `read_failed`. The server is the authorization boundary: `canEdit` only shows or hides controls.
 */

export interface TeamSkillView {
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  readonly category: string | null;
  readonly guidance: TeamSkillGuidance;
  readonly criteriaVersion: number;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface OwnTeamSkillRating {
  readonly skillId: string;
  readonly level: TeamSkillLevel;
  readonly criteriaVersion: number;
  readonly outdated: boolean;
}

export type TeamSkillsReadStatus = "unauthenticated" | "forbidden" | "team_disabled" | "read_failed" | "profile_unreadable";

export type TeamSkillsListResult =
  | { status: "ok"; skills: readonly TeamSkillView[]; canEdit: boolean; own: readonly OwnTeamSkillRating[]; truncated: boolean }
  | { status: TeamSkillsReadStatus | "assessment_unreadable" };

export type TeamSkillsWriteStatus =
  | "unauthenticated"
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "invalid_input"
  | "not_found"
  | "limit_reached"
  | "duplicate_name"
  | "skill_unavailable"
  | "assessment_unreadable"
  | "write_failed";

export type TeamSkillWriteResult = { status: "ok"; skill: TeamSkillView } | { status: TeamSkillsWriteStatus };
export type TeamSkillRatingResult =
  | { status: "ok"; level: TeamSkillLevel | null; criteriaVersion: number | null }
  | { status: TeamSkillsWriteStatus };

const READ_STATUSES = new Set(["unauthenticated", "forbidden", "team_disabled", "read_failed", "profile_unreadable"]);
const WRITE_STATUSES = new Set<string>([
  "unauthenticated",
  "forbidden",
  "team_disabled",
  "invalid_request",
  "invalid_input",
  "not_found",
  "limit_reached",
  "duplicate_name",
  "skill_unavailable",
  "assessment_unreadable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLevel(value: unknown): value is TeamSkillLevel {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function toGuidance(value: unknown): TeamSkillGuidance {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const key of ["1", "2", "3", "4"]) {
    const text = value[key];
    if (typeof text === "string" && text.length > 0) out[key] = text;
  }
  return out as TeamSkillGuidance;
}

function toSkill(value: unknown): TeamSkillView | null {
  if (!isRecord(value)) return null;
  const { skillId, name, description, category, guidance, criteriaVersion, active, sortOrder } = value;
  if (typeof skillId !== "string" || typeof name !== "string" || typeof description !== "string") return null;
  if (category !== null && typeof category !== "string") return null;
  if (typeof criteriaVersion !== "number" || typeof active !== "boolean" || typeof sortOrder !== "number") return null;
  return { skillId, name, description, category, guidance: toGuidance(guidance), criteriaVersion, active, sortOrder };
}

function toOwn(value: unknown): OwnTeamSkillRating | null {
  if (!isRecord(value)) return null;
  const { skillId, level, criteriaVersion, outdated } = value;
  if (typeof skillId !== "string" || !isLevel(level) || typeof criteriaVersion !== "number") return null;
  if (typeof outdated !== "boolean") return null;
  return { skillId, level, criteriaVersion, outdated };
}

function teamPath(teamId: string): string {
  return `/api/teams/${encodeURIComponent(teamId)}/team-skills`;
}

async function send(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  token: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: unknown } | { ok: false; status: 0; json: undefined }> {
  try {
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
    const json: unknown = await response.json().catch(() => undefined);
    return { ok: response.ok, status: response.status, json };
  } catch {
    return { ok: false, status: 0, json: undefined };
  }
}

function errorCode(json: unknown): string | undefined {
  return isRecord(json) && typeof json.error === "string" ? json.error : undefined;
}

function writeStatus(json: unknown): TeamSkillsWriteStatus {
  const code = errorCode(json);
  return code !== undefined && WRITE_STATUSES.has(code) ? (code as TeamSkillsWriteStatus) : "write_failed";
}

export async function fetchTeamSkills(token: string, teamId: string): Promise<TeamSkillsListResult> {
  const response = await send("GET", teamPath(teamId), token);
  if (!response.ok) {
    const code = errorCode(response.json);
    if (code !== undefined && READ_STATUSES.has(code)) return { status: code as TeamSkillsReadStatus };
    if (code === "assessment_unreadable") return { status: "assessment_unreadable" };
    return { status: "read_failed" };
  }
  if (!isRecord(response.json) || !Array.isArray(response.json.skills) || !Array.isArray(response.json.own)) {
    return { status: "read_failed" };
  }
  const skills = response.json.skills.map(toSkill);
  const own = response.json.own.map(toOwn);
  if (skills.some((skill) => skill === null) || own.some((rating) => rating === null)) return { status: "read_failed" };
  return {
    status: "ok",
    skills: skills as TeamSkillView[],
    own: own as OwnTeamSkillRating[],
    canEdit: response.json.canEdit === true,
    truncated: response.json.truncated === true,
  };
}

export async function createTeamSkill(
  token: string,
  teamId: string,
  input: { name: string; description: string; category: string; guidance: TeamSkillGuidance },
): Promise<TeamSkillWriteResult> {
  const response = await send("POST", teamPath(teamId), token, input);
  if (!response.ok) return { status: writeStatus(response.json) };
  const skill = isRecord(response.json) ? toSkill(response.json.skill) : null;
  return skill === null ? { status: "write_failed" } : { status: "ok", skill };
}

export async function updateTeamSkill(
  token: string,
  teamId: string,
  skillId: string,
  patch: Partial<{ name: string; description: string; category: string | null; guidance: TeamSkillGuidance; sortOrder: number; active: boolean }>,
): Promise<TeamSkillWriteResult> {
  const response = await send("PATCH", `${teamPath(teamId)}/${encodeURIComponent(skillId)}`, token, patch);
  if (!response.ok) return { status: writeStatus(response.json) };
  const skill = isRecord(response.json) ? toSkill(response.json.skill) : null;
  return skill === null ? { status: "write_failed" } : { status: "ok", skill };
}

export async function setOwnTeamSkillRating(
  token: string,
  teamId: string,
  skillId: string,
  level: TeamSkillLevel,
): Promise<TeamSkillRatingResult> {
  const response = await send("PUT", `${teamPath(teamId)}/${encodeURIComponent(skillId)}/level`, token, { level });
  if (!response.ok) return { status: writeStatus(response.json) };
  const body = isRecord(response.json) ? response.json : {};
  return { status: "ok", level, criteriaVersion: typeof body.criteriaVersion === "number" ? body.criteriaVersion : null };
}

export async function clearOwnTeamSkillRating(token: string, teamId: string, skillId: string): Promise<TeamSkillRatingResult> {
  const response = await send("DELETE", `${teamPath(teamId)}/${encodeURIComponent(skillId)}/level`, token);
  if (!response.ok) return { status: writeStatus(response.json) };
  return { status: "ok", level: null, criteriaVersion: null };
}

export type TeamOwnedSkillAggregateStatus =
  | { status: "ok"; availability: "available"; rows: TeamOwnedSkillAggregateRowView[] }
  | { status: "incomplete" }
  | { status: "unauthenticated" | "forbidden" | "team_disabled" | "read_failed" };

export type TeamOwnedSkillAggregateRowView =
  | { skillId: string; name: string; state: "value"; level: TeamSkillLevel }
  | { skillId: string; name: string; state: "insufficient_data" };

function toAggregateRow(value: unknown): TeamOwnedSkillAggregateRowView | null {
  if (!isRecord(value) || typeof value.skillId !== "string" || typeof value.name !== "string") return null;
  if (value.state === "insufficient_data") return { skillId: value.skillId, name: value.name, state: "insufficient_data" };
  if (value.state === "value" && isLevel(value.level)) {
    return { skillId: value.skillId, name: value.name, state: "value", level: value.level };
  }
  return null;
}

/** Team-level status of the team's active skills (members only). Read-only; contains no individual data. */
export async function fetchTeamSkillAggregate(token: string, teamId: string): Promise<TeamOwnedSkillAggregateStatus> {
  const response = await send("GET", `${teamPath(teamId)}/aggregate`, token);
  if (!response.ok) {
    const code = errorCode(response.json);
    if (code === "unauthenticated" || code === "forbidden" || code === "team_disabled") return { status: code };
    return { status: "read_failed" };
  }
  if (!isRecord(response.json) || !Array.isArray(response.json.rows)) return { status: "read_failed" };
  if (response.json.availability === "incomplete") return { status: "incomplete" };
  const rows = response.json.rows.map(toAggregateRow);
  if (rows.some((row) => row === null)) return { status: "read_failed" };
  return { status: "ok", availability: "available", rows: rows as TeamOwnedSkillAggregateRowView[] };
}

/** One agreed (collaborative) team level of an active team skill. Team-level value only; no actor is ever returned. */
export interface TeamManualAssessmentView {
  skillId: string;
  name: string;
  level: TeamSkillLevel;
  note: string | null;
  criteriaVersion: number;
  outdated: boolean;
  updatedAt: string;
}

export type TeamManualAssessmentsStatus =
  | { status: "ok"; canEdit: boolean; assessments: TeamManualAssessmentView[] }
  | { status: "unauthenticated" | "forbidden" | "team_disabled" | "read_failed" };

export type TeamManualWriteStatus = { status: "ok" } | { status: TeamSkillsWriteStatus | "persistence_failed" };

function toManualAssessment(value: unknown): TeamManualAssessmentView | null {
  if (!isRecord(value)) return null;
  const { skillId, name, level, note, criteriaVersion, outdated, updatedAt } = value;
  if (typeof skillId !== "string" || typeof name !== "string" || !isLevel(level)) return null;
  if (note !== null && typeof note !== "string") return null;
  if (typeof criteriaVersion !== "number" || typeof outdated !== "boolean" || typeof updatedAt !== "string") return null;
  return { skillId, name, level, note, criteriaVersion, outdated, updatedAt };
}

function manualPath(teamId: string): string {
  return `/api/teams/${encodeURIComponent(teamId)}/team-skills`;
}

/** The team's agreed levels for its active skills. Members and administrators only. Any malformed row fails the whole read. */
export async function fetchTeamManualAssessments(token: string, teamId: string): Promise<TeamManualAssessmentsStatus> {
  const response = await send("GET", `${manualPath(teamId)}/manual`, token);
  if (!response.ok) {
    const code = errorCode(response.json);
    if (code === "unauthenticated" || code === "forbidden" || code === "team_disabled") return { status: code };
    return { status: "read_failed" };
  }
  if (!isRecord(response.json) || !Array.isArray(response.json.assessments) || typeof response.json.canEdit !== "boolean") {
    return { status: "read_failed" };
  }
  const assessments = response.json.assessments.map(toManualAssessment);
  if (assessments.some((row) => row === null)) return { status: "read_failed" };
  return { status: "ok", canEdit: response.json.canEdit, assessments: assessments as TeamManualAssessmentView[] };
}

export async function setTeamManualAssessment(
  token: string,
  teamId: string,
  skillId: string,
  level: TeamSkillLevel,
  note: string | null,
): Promise<TeamManualWriteStatus> {
  const response = await send("PUT", `${manualPath(teamId)}/${encodeURIComponent(skillId)}/manual`, token, { level, note });
  if (!response.ok) {
    const code = errorCode(response.json);
    return { status: code === "persistence_failed" ? "persistence_failed" : writeStatus(response.json) };
  }
  return { status: "ok" };
}

export async function clearTeamManualAssessment(token: string, teamId: string, skillId: string): Promise<TeamManualWriteStatus> {
  const response = await send("DELETE", `${manualPath(teamId)}/${encodeURIComponent(skillId)}/manual`, token);
  if (!response.ok) return { status: writeStatus(response.json) };
  return { status: "ok" };
}
