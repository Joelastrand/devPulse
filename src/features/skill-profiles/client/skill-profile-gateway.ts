import { isSelfAssessedLevel, type SelfAssessedLevel } from "../domain/self-assessed-level";
import type { OwnSkillsDto } from "../domain/skill-profile-view";

/**
 * Browser gateway for the signed-in user's own skill self-assessment
 * (docs/features/individual-skill-self-assessment/SPEC.md — BR-8, BR-12–BR-15,
 * BR-17): thin `fetch` wrappers around `GET`/`DELETE /api/me/skills` and
 * `PUT`/`DELETE /api/me/skills/{treeId}`. The subject is only the token's own
 * identity — no uid, e-mail or team is ever sent; the only resource
 * identifier is a (URL-encoded) `treeId`. Browser code never touches
 * Firestore. Parsers are fail-safe: any unexpected shape becomes a generic
 * failure (`read_failed` for the read) instead of partially rendered data.
 */

export type FetchOwnSkillsResult =
  | { status: "ok"; dto: OwnSkillsDto }
  | { status: "unauthenticated" | "read_failed" };

export type SkillWriteError =
  | "unauthenticated"
  | "invalid_input"
  | "skill_unavailable"
  | "profile_unreadable"
  | "persistence_failed"
  | "unknown";

export type SetOwnSkillLevelResult = { ok: true; level: SelfAssessedLevel } | { ok: false; error: SkillWriteError };
export type ClearOwnSkillLevelResult = { ok: true; level: null } | { ok: false; error: SkillWriteError };

export type DeleteOwnSkillProfileResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "persistence_failed" | "unknown" };

const SKILLS_URL = "/api/me/skills";

function skillUrl(treeId: string): string {
  return `${SKILLS_URL}/${encodeURIComponent(treeId)}`;
}

function authorization(idToken: string): Record<string, string> {
  return { Authorization: `Bearer ${idToken}` };
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function errorCodeOf(status: number, body: unknown): string | undefined {
  if (isRecord(body) && typeof body.error === "string") return body.error;
  return status === 401 ? "unauthenticated" : undefined;
}

function parseOwnSkillsDto(body: unknown): OwnSkillsDto | undefined {
  if (!isRecord(body) || !hasExactKeys(body, ["skills", "truncated", "profile"])) return undefined;
  const { skills, truncated, profile } = body;
  if (!Array.isArray(skills) || typeof truncated !== "boolean" || (profile !== "ok" && profile !== "unreadable")) {
    return undefined;
  }

  const rows: OwnSkillsDto["skills"] = [];
  for (const row of skills) {
    if (!isRecord(row) || !hasExactKeys(row, ["treeId", "name", "level"])) return undefined;
    const { treeId, name, level } = row;
    if (typeof treeId !== "string" || treeId === "" || typeof name !== "string") return undefined;
    if (level !== null && !isSelfAssessedLevel(level)) return undefined;
    rows.push({ treeId, name, level });
  }
  return { skills: rows, truncated, profile };
}

function parseFetchResponse(status: number, body: unknown): FetchOwnSkillsResult {
  if (status === 200) {
    const dto = parseOwnSkillsDto(body);
    if (dto) return { status: "ok", dto };
  }
  return errorCodeOf(status, body) === "unauthenticated" ? { status: "unauthenticated" } : { status: "read_failed" };
}

function writeErrorOf(status: number, body: unknown): SkillWriteError {
  const code = errorCodeOf(status, body);
  if (code === "invalid_request") return "invalid_input";
  if (
    code === "unauthenticated" ||
    code === "invalid_input" ||
    code === "skill_unavailable" ||
    code === "profile_unreadable" ||
    code === "persistence_failed"
  ) {
    return code;
  }
  return "unknown";
}

/** Reads the caller's own skill list. A 200 with an unexpected shape is a read failure, never an empty profile. */
export async function fetchOwnSkills(idToken: string): Promise<FetchOwnSkillsResult> {
  try {
    const response = await fetch(SKILLS_URL, { headers: authorization(idToken) });
    return parseFetchResponse(response.status, await parseJson(response));
  } catch {
    return { status: "read_failed" };
  }
}

/** Sets one skill's level; the body is exactly `{ level }` and `level` in the result is the server's canonical value. */
export async function setOwnSkillLevel(
  idToken: string,
  treeId: string,
  level: SelfAssessedLevel,
): Promise<SetOwnSkillLevelResult> {
  try {
    const response = await fetch(skillUrl(treeId), {
      method: "PUT",
      headers: { ...authorization(idToken), "Content-Type": "application/json" },
      body: JSON.stringify({ level }),
    });
    const body = await parseJson(response);
    if (response.status === 200 && isRecord(body) && hasExactKeys(body, ["level"]) && isSelfAssessedLevel(body.level)) {
      return { ok: true, level: body.level };
    }
    return { ok: false, error: writeErrorOf(response.status, body) };
  } catch {
    return { ok: false, error: "unknown" };
  }
}

/** Clears one skill's level (back to "not assessed"); no request body. */
export async function clearOwnSkillLevel(idToken: string, treeId: string): Promise<ClearOwnSkillLevelResult> {
  try {
    const response = await fetch(skillUrl(treeId), { method: "DELETE", headers: authorization(idToken) });
    const body = await parseJson(response);
    if (response.status === 200 && isRecord(body) && hasExactKeys(body, ["level"]) && body.level === null) {
      return { ok: true, level: null };
    }
    return { ok: false, error: writeErrorOf(response.status, body) };
  } catch {
    return { ok: false, error: "unknown" };
  }
}

/** Erases the caller's whole skill profile; no request body. */
export async function deleteOwnSkillProfile(idToken: string): Promise<DeleteOwnSkillProfileResult> {
  try {
    const response = await fetch(SKILLS_URL, { method: "DELETE", headers: authorization(idToken) });
    const body = await parseJson(response);
    if (response.status === 200 && isRecord(body) && hasExactKeys(body, ["ok"]) && body.ok === true) {
      return { ok: true };
    }
    const error = writeErrorOf(response.status, body);
    return { ok: false, error: error === "unauthenticated" || error === "persistence_failed" ? error : "unknown" };
  } catch {
    return { ok: false, error: "unknown" };
  }
}
