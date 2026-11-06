import type { ProjectEffectiveStatus, ProjectLifecycleStatus, ProjectPriority } from "../domain/team-project";
import { isProjectLifecycleStatus } from "../domain/team-project";
import { isRoadmapPriority } from "../../roadmap/domain/roadmap-item";
import type { ProjectParticipationView } from "../server/write-project-participation";

/**
 * Client gateway for the team project APIs (SPEC BR-6, BR-8; TASK-005). Thin `fetch` wrappers: no Firestore access.
 * Responses are rebuilt field by field, so unexpected keys are dropped. The server is the authorization boundary.
 */

export interface ClientTeamProject {
  projectId: string;
  title: string;
  startDate: string;
  endDate: string;
  lifecycleStatus: ProjectLifecycleStatus;
  effectiveStatus: ProjectEffectiveStatus;
  priority: ProjectPriority;
  archived: boolean;
}

export interface ClientMember {
  memberRef: string;
  displayName: string | null;
}

export type ProjectListResult =
  | { status: "ok"; projects: ClientTeamProject[]; canEdit: boolean; truncated: boolean }
  | { status: "unauthenticated" | "forbidden" | "read_failed" };

export type ParticipationListResult =
  | { status: "ok"; participations: ProjectParticipationView[]; truncated: boolean }
  | { status: "unauthenticated" | "forbidden" | "read_failed" };

export type MemberListResult =
  | { status: "ok"; members: ClientMember[] }
  | { status: "unauthenticated" | "forbidden" | "read_failed" };

export type ProjectWriteInput = {
  title: string;
  startDate: string;
  endDate: string;
  lifecycleStatus: ProjectLifecycleStatus;
  priority: ProjectPriority;
};

export type ProjectWriteAction = "create" | "update" | "archive" | "restore";

export type ProjectWriteResult =
  | { status: "ok"; project: ClientTeamProject }
  | { status: "invalid_input"; issues: string[] }
  | { status: "unauthenticated" | "forbidden" | "not_found" | "conflict" | "write_failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const EFFECTIVE_STATUSES: readonly string[] = ["planned", "active", "completed"];

function parseProject(value: unknown): ClientTeamProject | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.projectId) ||
    typeof value.title !== "string" ||
    typeof value.startDate !== "string" ||
    typeof value.endDate !== "string" ||
    !isProjectLifecycleStatus(value.lifecycleStatus) ||
    typeof value.effectiveStatus !== "string" ||
    !EFFECTIVE_STATUSES.includes(value.effectiveStatus) ||
    !isRoadmapPriority(value.priority) ||
    typeof value.archived !== "boolean"
  ) {
    return null;
  }
  return {
    projectId: value.projectId,
    title: value.title,
    startDate: value.startDate,
    endDate: value.endDate,
    lifecycleStatus: value.lifecycleStatus,
    effectiveStatus: value.effectiveStatus as ProjectEffectiveStatus,
    priority: value.priority,
    archived: value.archived,
  };
}

function parseParticipation(value: unknown): ProjectParticipationView | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.participationId) ||
    !isNonEmptyString(value.projectId) ||
    !isNonEmptyString(value.memberRef) ||
    typeof value.startDate !== "string" ||
    typeof value.endDate !== "string" ||
    (value.note !== null && typeof value.note !== "string") ||
    typeof value.archived !== "boolean" ||
    typeof value.overlapsOther !== "boolean"
  ) {
    return null;
  }
  return {
    participationId: value.participationId,
    projectId: value.projectId,
    memberRef: value.memberRef,
    startDate: value.startDate,
    endDate: value.endDate,
    note: value.note as string | null,
    archived: value.archived,
    overlapsOther: value.overlapsOther,
  };
}

function parseMember(value: unknown): ClientMember | null {
  if (!isRecord(value) || !isNonEmptyString(value.memberRef)) return null;
  if (value.displayName !== null && typeof value.displayName !== "string") return null;
  return { memberRef: value.memberRef, displayName: value.displayName as string | null };
}

function readFailureStatus(status: number): "unauthenticated" | "forbidden" | "read_failed" {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  return "read_failed";
}

function writeFailureStatus(status: number): "unauthenticated" | "forbidden" | "not_found" | "conflict" | "write_failed" {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "write_failed";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchTeamProjects(idToken: string, teamId: string): Promise<ProjectListResult> {
  try {
    const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/projects?archived=true`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) return { status: readFailureStatus(response.status) };
    const body = await readJson(response);
    if (!isRecord(body) || !Array.isArray(body.projects) || typeof body.canEdit !== "boolean" || typeof body.truncated !== "boolean") {
      return { status: "read_failed" };
    }
    const projects = body.projects.map(parseProject);
    if (projects.some((project) => project === null)) return { status: "read_failed" };
    return { status: "ok", projects: projects as ClientTeamProject[], canEdit: body.canEdit, truncated: body.truncated };
  } catch {
    return { status: "read_failed" };
  }
}

export async function fetchProjectParticipations(
  idToken: string,
  teamId: string,
  projectId: string,
): Promise<ParticipationListResult> {
  try {
    const response = await fetch(
      `/api/teams/${encodeURIComponent(teamId)}/projects/${encodeURIComponent(projectId)}/participations`,
      { headers: { Authorization: `Bearer ${idToken}` } },
    );
    if (!response.ok) return { status: readFailureStatus(response.status) };
    const body = await readJson(response);
    if (!isRecord(body) || !Array.isArray(body.participations) || typeof body.truncated !== "boolean") {
      return { status: "read_failed" };
    }
    const participations = body.participations.map(parseParticipation);
    if (participations.some((item) => item === null)) return { status: "read_failed" };
    return { status: "ok", participations: participations as ProjectParticipationView[], truncated: body.truncated };
  } catch {
    return { status: "read_failed" };
  }
}

export async function fetchAssignableMembers(idToken: string, teamId: string): Promise<MemberListResult> {
  try {
    const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/assignable-members`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) return { status: readFailureStatus(response.status) };
    const body = await readJson(response);
    if (!isRecord(body) || !Array.isArray(body.members)) return { status: "read_failed" };
    const members = body.members.map(parseMember);
    if (members.some((member) => member === null)) return { status: "read_failed" };
    return { status: "ok", members: members as ClientMember[] };
  } catch {
    return { status: "read_failed" };
  }
}

/** Create, update, archive or restore one project. Archive and restore send no body. */
export async function writeTeamProject(
  idToken: string,
  teamId: string,
  action: ProjectWriteAction,
  projectId: string | null,
  input: ProjectWriteInput | null,
): Promise<ProjectWriteResult> {
  const base = `/api/teams/${encodeURIComponent(teamId)}/projects`;
  const encodedProject = projectId === null ? "" : `/${encodeURIComponent(projectId)}`;
  const request: { url: string; method: "POST" | "PATCH"; body?: ProjectWriteInput } =
    action === "create"
      ? { url: base, method: "POST", body: input ?? undefined }
      : action === "update"
        ? { url: `${base}${encodedProject}`, method: "PATCH", body: input ?? undefined }
        : { url: `${base}${encodedProject}/${action}`, method: "POST" };

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(request.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    });
    const body = await readJson(response);
    if (response.ok) {
      const project = isRecord(body) ? parseProject(body.project) : null;
      return project ? { status: "ok", project } : { status: "write_failed" };
    }
    if (response.status === 400 && isRecord(body) && body.error === "invalid_input" && Array.isArray(body.issues)) {
      return { status: "invalid_input", issues: body.issues.filter((issue): issue is string => typeof issue === "string") };
    }
    return { status: writeFailureStatus(response.status) };
  } catch {
    return { status: "write_failed" };
  }
}
