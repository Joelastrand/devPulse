import type { KnowledgeRiskBand, AssessmentAttribute } from "../domain/team-system";
import { ASSESSMENT_ATTRIBUTES, isAssessmentValue, isAssessmentAttribute } from "../domain/team-system";
import type { AssessmentView, KnowledgeMemberView, TeamSystemView } from "../server/list-team-systems";

/**
 * Client gateway for `/api/teams/[teamId]/systems` (docs/archive/features/
 * team-system-overview/SPEC.md). Thin `fetch` wrapper; no Firestore access.
 * Responses are rebuilt field by field, so unexpected keys are dropped; a
 * malformed body fails safe to `read_failed`. The server is the privacy
 * boundary, not this parser.
 */

export type TeamSystemsReadResult =
  | { status: "ok"; systems: TeamSystemView[]; canEdit: boolean; truncated: boolean }
  | { status: "unauthenticated" | "forbidden" | "read_failed" };

export type TeamSystemMutationError =
  | "unauthenticated"
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "invalid_input"
  | "invalid_knowledge"
  | "not_found"
  | "limit_reached"
  | "erasure_in_progress"
  | "persistence_failed"
  /** No usable response (network/parse): the write may or may not have happened. */
  | "request_failed";

export type TeamSystemMutationResult = { ok: true; systemId: string } | { ok: false; error: TeamSystemMutationError };

export interface AssignableMemberOption {
  memberRef: string;
  displayName: string | null;
  isSelf: boolean;
}

export type AssignableMembersResult =
  | { status: "ok"; members: AssignableMemberOption[]; truncated: boolean }
  | { status: "unauthenticated" | "forbidden" | "read_failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseAssessment(value: unknown): AssessmentView | undefined {
  if (!isRecord(value) || !isAssessmentValue(value.value)) return undefined;
  if (!isNullableString(value.note) || !isNullableString(value.assessedAt)) return undefined;
  return { value: value.value, note: value.note, assessedAt: value.assessedAt };
}

function parseKnowledge(value: unknown): KnowledgeMemberView | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.memberRef)) return undefined;
  if (!isNullableString(value.displayName) || typeof value.isSelf !== "boolean") return undefined;
  return { memberRef: value.memberRef, displayName: value.displayName, isSelf: value.isSelf };
}

const RISK_BANDS: readonly string[] = ["none", "high", "elevated", "lower"];

function parseSystem(value: unknown): TeamSystemView | null {
  if (!isRecord(value) || !isRecord(value.assessments)) return null;
  const assessments = {} as Record<AssessmentAttribute, AssessmentView>;
  for (const [key, raw] of Object.entries(value.assessments)) {
    if (!isAssessmentAttribute(key)) return null;
    const parsed = parseAssessment(raw);
    if (parsed === undefined) return null;
    assessments[key] = parsed;
  }
  if (!ASSESSMENT_ATTRIBUTES.every((key) => key in assessments)) return null;
  if (!Array.isArray(value.knowledge)) return null;
  const knowledge = value.knowledge.map(parseKnowledge);
  if (!knowledge.every((item): item is KnowledgeMemberView => item !== undefined)) return null;
  if (!isNonEmptyString(value.systemId) || !isNonEmptyString(value.name)) return null;
  if (!isNullableString(value.description) || !isNullableString(value.backstageUrl)) return null;
  if (typeof value.knowledgeRisk !== "string" || !RISK_BANDS.includes(value.knowledgeRisk)) return null;
  if (typeof value.attention !== "boolean") return null;
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return null;

  return {
    systemId: value.systemId,
    name: value.name,
    description: value.description,
    backstageUrl: value.backstageUrl,
    assessments,
    knowledge,
    knowledgeRisk: value.knowledgeRisk as KnowledgeRiskBand,
    attention: value.attention,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseReadResponse(httpStatus: number, body: unknown): TeamSystemsReadResult {
  if (isRecord(body) && Array.isArray(body.systems) && typeof body.canEdit === "boolean" && typeof body.truncated === "boolean") {
    const systems = body.systems.map(parseSystem);
    if (systems.every((system): system is TeamSystemView => system !== null)) {
      return { status: "ok", systems, canEdit: body.canEdit, truncated: body.truncated };
    }
    return { status: "read_failed" };
  }
  if (httpStatus === 401) return { status: "unauthenticated" };
  if (httpStatus === 403) return { status: "forbidden" };
  return { status: "read_failed" };
}

const MUTATION_ERRORS: readonly string[] = [
  "unauthenticated",
  "forbidden",
  "team_disabled",
  "invalid_request",
  "invalid_input",
  "invalid_knowledge",
  "not_found",
  "limit_reached",
  "erasure_in_progress",
  "persistence_failed",
];

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function sendMutation(
  method: "POST" | "PATCH",
  url: string,
  idToken: string,
  body: Record<string, unknown>,
): Promise<TeamSystemMutationResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = await readJson(response);
    if (response.ok && isRecord(parsed) && isNonEmptyString(parsed.systemId)) {
      return { ok: true, systemId: parsed.systemId };
    }
    if (isRecord(parsed) && typeof parsed.error === "string" && MUTATION_ERRORS.includes(parsed.error)) {
      return { ok: false, error: parsed.error as TeamSystemMutationError };
    }
    if (response.status === 401) return { ok: false, error: "unauthenticated" };
    if (response.status === 403) return { ok: false, error: "forbidden" };
    return { ok: false, error: "request_failed" };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

function systemsUrl(teamId: string): string {
  return `/api/teams/${encodeURIComponent(teamId)}/systems`;
}

export async function fetchTeamSystems(idToken: string, teamId: string): Promise<TeamSystemsReadResult> {
  try {
    const response = await fetch(systemsUrl(teamId), {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });
    return parseReadResponse(response.status, await readJson(response));
  } catch {
    return { status: "read_failed" };
  }
}

export function createTeamSystem(idToken: string, teamId: string, body: Record<string, unknown>): Promise<TeamSystemMutationResult> {
  return sendMutation("POST", systemsUrl(teamId), idToken, body);
}

export function updateTeamSystem(
  idToken: string,
  teamId: string,
  systemId: string,
  body: Record<string, unknown>,
): Promise<TeamSystemMutationResult> {
  return sendMutation("PATCH", `${systemsUrl(teamId)}/${encodeURIComponent(systemId)}`, idToken, body);
}

/**
 * Knowledge selector options (`GET /api/teams/[teamId]/assignable-members`, the
 * existing team endpoint). Only `memberRef` identifies a member; it is never shown.
 */
export async function fetchAssignableMembers(idToken: string, teamId: string): Promise<AssignableMembersResult> {
  try {
    const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/assignable-members`, {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });
    const body = await readJson(response);
    if (response.ok && isRecord(body) && Array.isArray(body.members) && typeof body.truncated === "boolean") {
      const members: AssignableMemberOption[] = [];
      for (const m of body.members) {
        if (!isRecord(m) || !isNonEmptyString(m.memberRef) || !isNullableString(m.displayName) || typeof m.isSelf !== "boolean") {
          return { status: "read_failed" };
        }
        members.push({ memberRef: m.memberRef, displayName: m.displayName, isSelf: m.isSelf });
      }
      return { status: "ok", members, truncated: body.truncated };
    }
    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status === 403) return { status: "forbidden" };
    return { status: "read_failed" };
  } catch {
    return { status: "read_failed" };
  }
}

