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

export type FetchSkillNeedsResult =
  | { status: "ok"; needs: SkillNeedView[]; needsTruncated: boolean; viewer: SkillNeedsViewerHints }
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

function parseViewer(value: unknown): SkillNeedsViewerHints | null {
  if (!isRecord(value)) return null;
  const { canManageNeeds, canReadCoverage } = value;
  if (typeof canManageNeeds !== "boolean" || typeof canReadCoverage !== "boolean") return null;
  return { canManageNeeds, canReadCoverage };
}

function parseSuccess(body: unknown): FetchSkillNeedsResult {
  if (!isRecord(body) || !Array.isArray(body.needs) || typeof body.needsTruncated !== "boolean") {
    return { status: "read_failed" };
  }
  const needs = body.needs.map(parseNeed);
  const viewer = parseViewer(body.viewer);
  if (viewer === null || !needs.every((need): need is SkillNeedView => need !== null)) {
    return { status: "read_failed" };
  }
  return { status: "ok", needs, needsTruncated: body.needsTruncated, viewer };
}

export interface TeamSkillsGateway {
  fetchSkillNeeds(idToken: string, teamId: string): Promise<FetchSkillNeedsResult>;
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
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return { status: "read_failed" };
        }
        return parseSuccess(body);
      } catch {
        return { status: "read_failed" };
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
