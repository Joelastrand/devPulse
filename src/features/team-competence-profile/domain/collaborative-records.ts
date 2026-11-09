/**
 * Persisted shapes and input parsers for the collaborative (Felles) team profile.
 *
 * Two team-level collections, neither of which holds a uid, an actor, a memberRef or any member assessment:
 * - `teamProfileSettings/{teamId}`: the team's selected profile mode.
 * - `teamCollaborativeLevels/{teamId}__{treeId}`: one teamadmin-entered integer 1–4 for one competence area.
 *
 * Validation is fail-closed: an extra or missing key, a wrong document id or an out-of-range value makes the stored
 * record invalid, and the gateway reports `read_failed` rather than repairing or defaulting it.
 */
import { isWellFormedTreeId } from "../../skill-profiles/domain/skill-profile";
import { isSelfAssessedLevel, type SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { parseCollaborativeLevelInput } from "../../team-skills/domain/collaborative-level-input";
import { parseProfileMode, type ProfileMode } from "./collaborative-profile";

export const PROFILE_SETTINGS_COLLECTION = "teamProfileSettings";
export const COLLABORATIVE_LEVELS_COLLECTION = "teamCollaborativeLevels";

export interface ProfileSettingsRecord {
  teamId: string;
  mode: ProfileMode;
  updatedAt: Date;
}

export interface CollaborativeLevelRecord {
  teamId: string;
  treeId: string;
  level: SelfAssessedLevel;
  updatedAt: Date;
}

export const PROFILE_SETTINGS_KEYS = ["teamId", "mode", "updatedAt"] as const;
export const COLLABORATIVE_LEVEL_KEYS = ["teamId", "treeId", "level", "updatedAt"] as const;

/** Deterministic document id. A uniqueness device only: never parsed apart and never proof of authorization. */
export function collaborativeLevelDocId(teamId: string, treeId: string): string {
  return `${teamId}__${treeId}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True only when the object has exactly the given keys, no more and no fewer. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isValidProfileSettings(data: unknown, docId: string): data is ProfileSettingsRecord {
  if (!isPlainRecord(data) || !hasExactKeys(data, PROFILE_SETTINGS_KEYS)) return false;
  return data.teamId === docId && parseProfileMode(data.mode) !== null && isValidDate(data.updatedAt);
}

export function isValidCollaborativeLevel(data: unknown, docId: string): data is CollaborativeLevelRecord {
  if (!isPlainRecord(data) || !hasExactKeys(data, COLLABORATIVE_LEVEL_KEYS)) return false;
  const { teamId, treeId, level, updatedAt } = data;
  if (typeof teamId !== "string" || teamId.length === 0 || !isWellFormedTreeId(treeId)) return false;
  if (docId !== collaborativeLevelDocId(teamId, treeId)) return false;
  return isSelfAssessedLevel(level) && isValidDate(updatedAt);
}

export type ProfileInputResult<T> = { ok: true; value: T } | { ok: false; error: "invalid_request" | "invalid_input" };

/** Mode body: exactly `{ mode }`. */
export function parseProfileSettingsBody(body: unknown): ProfileInputResult<{ mode: ProfileMode }> {
  if (!isPlainRecord(body) || !hasExactKeys(body, ["mode"])) return { ok: false, error: "invalid_request" };
  const mode = parseProfileMode(body.mode);
  if (mode === null) return { ok: false, error: "invalid_input" };
  return { ok: true, value: { mode } };
}

/** Level body: exactly `{ level }`, where level is an integer 1–4 or `null` to clear the team value. */
export function parseCollaborativeLevelBody(body: unknown): ProfileInputResult<{ level: SelfAssessedLevel | null }> {
  if (!isPlainRecord(body) || !hasExactKeys(body, ["level"])) return { ok: false, error: "invalid_request" };
  const parsed = parseCollaborativeLevelInput(body.level);
  if (!parsed.ok) return { ok: false, error: "invalid_input" };
  return { ok: true, value: { level: parsed.level } };
}
