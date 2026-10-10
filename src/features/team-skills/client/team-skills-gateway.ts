import { isRequiredCoverage, isRequiredLevel, type RequiredLevel } from "../domain/skill-need";

/**
 * Browser gateway for the team skill needs (docs/features/team-skill-needs-and-matrix/
 * SPEC.md — BR-4): a thin `fetch` wrapper around `GET /api/teams/[teamId]/skill-needs`.
 * The parser rebuilds every need from the five contract fields and the `viewer`
 * hints from their two booleans, so anything else a response might carry is
 * dropped rather than passed to the UI; a malformed response fails safe to
 * `read_failed`. The parser is not the privacy or authorization boundary (the
 * server is), and `viewer` only hides controls.
 */

export interface SkillNeedView {
  treeId: string;
  areaName: string | null;
  areaAvailable: boolean;
  requiredLevel: RequiredLevel;
  requiredCoverage: number;
}

export interface SkillNeedsViewerHints {
  canManageNeeds: boolean;
  canReadCoverage: boolean;
}

export interface SkillCatalogEntry {
  treeId: string;
  name: string;
}

export type FetchSkillNeedsResult =
  | {
      status: "ok";
      needs: SkillNeedView[];
      catalog: SkillCatalogEntry[];
      catalogTruncated: boolean;
      needsTruncated: boolean;
      viewer: SkillNeedsViewerHints;
    }
  | { status: "unauthenticated" | "forbidden" | "read_failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNeed(value: unknown): SkillNeedView | null {
  if (!isRecord(value)) return null;
  const { treeId, areaName, areaAvailable, requiredLevel, requiredCoverage } = value;
  if (typeof treeId !== "string" || treeId.length === 0) return null;
  if (typeof areaAvailable !== "boolean") return null;
  if (areaName !== null && typeof areaName !== "string") return null;
  if (!isRequiredLevel(requiredLevel) || !isRequiredCoverage(requiredCoverage)) return null;
  return { treeId, areaName: areaAvailable ? areaName : null, areaAvailable, requiredLevel, requiredCoverage };
}

function parseCatalogEntry(value: unknown): SkillCatalogEntry | null {
  if (!isRecord(value)) return null;
  const { treeId, name } = value;
  if (typeof treeId !== "string" || treeId.length === 0 || typeof name !== "string" || name.length === 0) return null;
  return { treeId, name };
}

function parseViewer(value: unknown): SkillNeedsViewerHints | null {
  if (!isRecord(value)) return null;
  const { canManageNeeds, canReadCoverage } = value;
  if (typeof canManageNeeds !== "boolean" || typeof canReadCoverage !== "boolean") return null;
  return { canManageNeeds, canReadCoverage };
}

function parseSuccess(body: unknown): FetchSkillNeedsResult {
  if (
    !isRecord(body) ||
    !Array.isArray(body.needs) ||
    !Array.isArray(body.catalog) ||
    typeof body.needsTruncated !== "boolean" ||
    typeof body.catalogTruncated !== "boolean"
  ) {
    return { status: "read_failed" };
  }
  const needs = body.needs.map(parseNeed);
  const catalog = body.catalog.map(parseCatalogEntry);
  const viewer = parseViewer(body.viewer);
  if (
    viewer === null ||
    !needs.every((need): need is SkillNeedView => need !== null) ||
    !catalog.every((entry): entry is SkillCatalogEntry => entry !== null)
  ) {
    return { status: "read_failed" };
  }
  return {
    status: "ok",
    needs,
    catalog,
    catalogTruncated: body.catalogTruncated,
    needsTruncated: body.needsTruncated,
    viewer,
  };
}

export type SkillNeedWriteError =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "skill_unavailable"
  | "team_disabled"
  | "persistence_failed"
  | "unknown";

export type PutSkillNeedResult = { ok: true; need: SkillNeedView } | { ok: false; error: SkillNeedWriteError };
export type DeleteSkillNeedResult = { ok: true } | { ok: false; error: SkillNeedWriteError };

/** The only two persisted planning fields a lead may set (SPEC BR-2). */
export interface SkillNeedInput {
  requiredLevel: RequiredLevel;
  requiredCoverage: number;
}

export interface TeamSkillsGateway {
  fetchSkillNeeds(idToken: string, teamId: string): Promise<FetchSkillNeedsResult>;
  putSkillNeed(idToken: string, teamId: string, treeId: string, input: SkillNeedInput): Promise<PutSkillNeedResult>;
  deleteSkillNeed(idToken: string, teamId: string, treeId: string): Promise<DeleteSkillNeedResult>;
}

function needUrl(teamId: string, treeId: string): string {
  return `/api/teams/${encodeURIComponent(teamId)}/skill-needs/${encodeURIComponent(treeId)}`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Server error codes map to a closed set; an unrecognised code or status is `unknown`, never surfaced raw. */
function writeError(status: number, body: unknown): SkillNeedWriteError {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  const code = isRecord(body) ? body.error : undefined;
  if (status === 400 && (code === "invalid_input" || code === "invalid_request")) return "invalid_input";
  if (status === 404 && code === "skill_unavailable") return "skill_unavailable";
  if (status === 409 && code === "team_disabled") return "team_disabled";
  if (status === 500 && code === "persistence_failed") return "persistence_failed";
  return "unknown";
}

function getDefaultGateway(): TeamSkillsGateway {
  return {
    async fetchSkillNeeds(idToken, teamId) {
      try {
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/skill-needs`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (response.status === 401) return { status: "unauthenticated" };
        if (response.status === 403) return { status: "forbidden" };
        if (!response.ok) return { status: "read_failed" };
        const body = await readJson(response);
        return body === undefined ? { status: "read_failed" } : parseSuccess(body);
      } catch {
        return { status: "read_failed" };
      }
    },

    async putSkillNeed(idToken, teamId, treeId, input) {
      // UX guard only: the server re-validates and is the authority.
      if (!isRequiredLevel(input.requiredLevel) || !isRequiredCoverage(input.requiredCoverage)) {
        return { ok: false, error: "invalid_input" };
      }
      try {
        const response = await fetch(needUrl(teamId, treeId), {
          method: "PUT",
          headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ requiredLevel: input.requiredLevel, requiredCoverage: input.requiredCoverage }),
        });
        const body = await readJson(response);
        if (!response.ok) return { ok: false, error: writeError(response.status, body) };
        const need = isRecord(body) ? parseNeed(body.need) : null;
        return need === null ? { ok: false, error: "unknown" } : { ok: true, need };
      } catch {
        return { ok: false, error: "unknown" };
      }
    },

    async deleteSkillNeed(idToken, teamId, treeId) {
      try {
        const response = await fetch(needUrl(teamId, treeId), {
          method: "DELETE",
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!response.ok) return { ok: false, error: writeError(response.status, await readJson(response)) };
        return { ok: true };
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface FetchSkillNeedsDeps {
  gateway?: TeamSkillsGateway;
}

export async function fetchSkillNeeds(
  idToken: string,
  teamId: string,
  deps: FetchSkillNeedsDeps = {},
): Promise<FetchSkillNeedsResult> {
  return (deps.gateway ?? getDefaultGateway()).fetchSkillNeeds(idToken, teamId);
}

export async function putSkillNeed(
  idToken: string,
  teamId: string,
  treeId: string,
  input: SkillNeedInput,
  deps: FetchSkillNeedsDeps = {},
): Promise<PutSkillNeedResult> {
  return (deps.gateway ?? getDefaultGateway()).putSkillNeed(idToken, teamId, treeId, input);
}

export async function deleteSkillNeed(
  idToken: string,
  teamId: string,
  treeId: string,
  deps: FetchSkillNeedsDeps = {},
): Promise<DeleteSkillNeedResult> {
  return (deps.gateway ?? getDefaultGateway()).deleteSkillNeed(idToken, teamId, treeId);
}
