/**
 * Strict DTO for the automatic numeric team profile (`GET /api/teams/[teamId]/skill-levels`). Pure: no I/O, no framework.
 *
 * Allow-list only. The wire shape carries the competence area, its target, a state and, for a value only, the integer team
 * level. It never carries an identity, an individual rating, a contributor count, `requiredCoverage` or a sum. Both the route
 * (serialisation) and the client (parsing) use these functions, so a field outside the allow-list is dropped on the way out
 * and rejected on the way in.
 */
import { isSelfAssessedLevel, type SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { REQUIRED_LEVELS, type RequiredLevel } from "./skill-need";

export type TeamSkillLevelDto =
  | { readonly treeId: string; readonly areaName: string; readonly targetLevel: RequiredLevel; readonly state: "value"; readonly level: SelfAssessedLevel }
  | { readonly treeId: string; readonly areaName: string; readonly targetLevel: RequiredLevel; readonly state: "insufficient_data" }
  | { readonly treeId: string; readonly areaName: null; readonly targetLevel: RequiredLevel; readonly state: "area_unavailable" };

export interface TeamSkillLevelsDto {
  readonly availability: "available" | "incomplete";
  readonly rows: readonly TeamSkillLevelDto[];
}

/** Input shape: the operation's row, with the team-level value only on a `value` row. */
export type TeamSkillLevelInput =
  | { readonly treeId: string; readonly areaName: string; readonly targetLevel: RequiredLevel; readonly state: "value"; readonly level: SelfAssessedLevel }
  | { readonly treeId: string; readonly areaName: string; readonly targetLevel: RequiredLevel; readonly state: "insufficient_data" }
  | { readonly treeId: string; readonly areaName: null; readonly targetLevel: RequiredLevel; readonly state: "area_unavailable" };

/** Builds one wire row field by field. Any other property of the input is never copied. */
export function toTeamSkillLevelDto(row: TeamSkillLevelInput): TeamSkillLevelDto {
  switch (row.state) {
    case "value":
      return { treeId: row.treeId, areaName: row.areaName, targetLevel: row.targetLevel, state: "value", level: row.level };
    case "insufficient_data":
      return { treeId: row.treeId, areaName: row.areaName, targetLevel: row.targetLevel, state: "insufficient_data" };
    case "area_unavailable":
      return { treeId: row.treeId, areaName: null, targetLevel: row.targetLevel, state: "area_unavailable" };
  }
}

/** Builds the response. An `incomplete` scan carries no rows. */
export function toTeamSkillLevelsDto(response: { availability: "available"; rows: readonly TeamSkillLevelInput[] } | { availability: "incomplete" }): TeamSkillLevelsDto {
  if (response.availability === "incomplete") return { availability: "incomplete", rows: [] };
  return { availability: "available", rows: response.rows.map(toTeamSkillLevelDto) };
}

function isRequiredLevel(value: unknown): value is RequiredLevel {
  return typeof value === "number" && (REQUIRED_LEVELS as readonly number[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses one wire row. Returns `undefined` for any shape outside the allow-list, so the caller fails closed. */
function parseRow(value: unknown): TeamSkillLevelDto | undefined {
  if (!isRecord(value)) return undefined;
  const { treeId, areaName, targetLevel, state } = value;
  if (typeof treeId !== "string" || treeId.length === 0 || !isRequiredLevel(targetLevel)) return undefined;
  if (state === "value") {
    if (typeof areaName !== "string" || areaName.length === 0 || !isSelfAssessedLevel(value.level)) return undefined;
    return { treeId, areaName, targetLevel, state, level: value.level };
  }
  if (state === "insufficient_data") {
    if (typeof areaName !== "string" || areaName.length === 0) return undefined;
    return { treeId, areaName, targetLevel, state };
  }
  if (state === "area_unavailable") {
    if (areaName !== null) return undefined;
    return { treeId, areaName: null, targetLevel, state };
  }
  return undefined;
}

/** Parses a response body. Any unexpected key, shape or value makes the whole body invalid (`undefined`). */
export function parseTeamSkillLevelsDto(body: unknown): TeamSkillLevelsDto | undefined {
  if (!isRecord(body)) return undefined;
  const { availability, rows } = body;
  if (!Array.isArray(rows)) return undefined;
  // An incomplete scan is valid only with no rows: nothing may be shown from a known-incomplete cohort.
  if (availability === "incomplete") return rows.length === 0 ? { availability, rows: [] } : undefined;
  if (availability !== "available") return undefined;
  const parsed: TeamSkillLevelDto[] = [];
  for (const raw of rows) {
    const row = parseRow(raw);
    if (row === undefined) return undefined;
    parsed.push(row);
  }
  return { availability, rows: parsed };
}
