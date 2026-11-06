import type { SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { isSelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { isRoadmapPriority, type RoadmapPriority } from "../../roadmap/domain/roadmap-item";
import { isMilestoneStatus, type MilestoneStatus } from "../domain/competence-plan";

/**
 * Client gateway for the team competence plan API (TASK-006). Thin `fetch` wrappers: no Firestore access. Responses are
 * rebuilt field by field, so unexpected keys are dropped. The server is the authorization boundary.
 */

export interface ClientMilestone {
  id: string;
  title: string;
  targetDate: string | null;
  status: MilestoneStatus;
}

export interface ClientCompetencePlan {
  treeId: string;
  targetStage: SelfAssessedLevel;
  priority: RoadmapPriority;
  archived: boolean;
  milestones: ClientMilestone[];
  progress: { completed: number; total: number };
}

/** Team-assigned catalog area, names only (no ratings). `name` is `null` when the catalog entry is unavailable. */
export interface ClientCompetenceArea {
  treeId: string;
  name: string | null;
  status: "active" | "inactive" | "archived";
}

export type ClientReadStatus = "unauthenticated" | "forbidden" | "read_failed";

export type CompetencePlanListResult =
  | { status: "ok"; plans: ClientCompetencePlan[]; canEdit: boolean; truncated: boolean }
  | { status: ClientReadStatus };

export type CompetenceAreaListResult = { status: "ok"; areas: ClientCompetenceArea[] } | { status: ClientReadStatus };

export interface CompetencePlanInput {
  targetStage: SelfAssessedLevel;
  priority: RoadmapPriority;
  archived: boolean;
  milestones: { id?: string; title: string; targetDate: string | null; status: MilestoneStatus }[];
}

export type CompetencePlanWriteResult =
  | { status: "ok"; plan: ClientCompetencePlan }
  | { status: "invalid_input"; issues: string[] }
  | { status: "unauthenticated" | "forbidden" | "conflict" | "write_failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMilestone(value: unknown): ClientMilestone | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.title !== "string" ||
    (value.targetDate !== null && typeof value.targetDate !== "string") ||
    !isMilestoneStatus(value.status)
  ) {
    return null;
  }
  return { id: value.id, title: value.title, targetDate: value.targetDate as string | null, status: value.status };
}

function parsePlan(value: unknown): ClientCompetencePlan | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.treeId !== "string" ||
    value.treeId.length === 0 ||
    !isSelfAssessedLevel(value.targetStage) ||
    !isRoadmapPriority(value.priority) ||
    typeof value.archived !== "boolean" ||
    !Array.isArray(value.milestones) ||
    !isRecord(value.progress) ||
    typeof value.progress.completed !== "number" ||
    typeof value.progress.total !== "number"
  ) {
    return null;
  }
  const milestones: ClientMilestone[] = [];
  for (const item of value.milestones) {
    const milestone = parseMilestone(item);
    if (milestone === null) return null;
    milestones.push(milestone);
  }
  return {
    treeId: value.treeId,
    targetStage: value.targetStage,
    priority: value.priority,
    archived: value.archived,
    milestones,
    progress: { completed: value.progress.completed, total: value.progress.total },
  };
}

function parseArea(value: unknown): ClientCompetenceArea | null {
  if (!isRecord(value) || typeof value.treeId !== "string" || value.treeId.length === 0) return null;
  if (value.name !== null && typeof value.name !== "string") return null;
  if (value.status !== "active" && value.status !== "inactive" && value.status !== "archived") return null;
  return { treeId: value.treeId, name: value.name as string | null, status: value.status };
}

function readFailureStatus(status: number): ClientReadStatus {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  return "read_failed";
}

function writeFailureStatus(status: number): "unauthenticated" | "forbidden" | "conflict" | "write_failed" {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 409) return "conflict";
  return "write_failed";
}

export async function fetchCompetencePlans(idToken: string, teamId: string, includeArchived = false): Promise<CompetencePlanListResult> {
  try {
    const response = await fetch(
      `/api/teams/${encodeURIComponent(teamId)}/competence-plans${includeArchived ? "?archived=true" : ""}`,
      { headers: { Authorization: `Bearer ${idToken}` } },
    );
    if (!response.ok) return { status: readFailureStatus(response.status) };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.plans) || typeof body.canEdit !== "boolean" || typeof body.truncated !== "boolean") {
      return { status: "read_failed" };
    }
    const plans: ClientCompetencePlan[] = [];
    for (const item of body.plans) {
      const plan = parsePlan(item);
      if (plan === null) return { status: "read_failed" };
      plans.push(plan);
    }
    return { status: "ok", plans, canEdit: body.canEdit, truncated: body.truncated };
  } catch {
    return { status: "read_failed" };
  }
}

export async function fetchCompetenceAreas(idToken: string, teamId: string): Promise<CompetenceAreaListResult> {
  try {
    const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/competence-areas`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) return { status: readFailureStatus(response.status) };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.areas)) return { status: "read_failed" };
    const areas: ClientCompetenceArea[] = [];
    for (const item of body.areas) {
      const area = parseArea(item);
      if (area === null) return { status: "read_failed" };
      areas.push(area);
    }
    return { status: "ok", areas };
  } catch {
    return { status: "read_failed" };
  }
}

export async function putCompetencePlan(
  idToken: string,
  teamId: string,
  treeId: string,
  input: CompetencePlanInput,
): Promise<CompetencePlanWriteResult> {
  try {
    const response = await fetch(
      `/api/teams/${encodeURIComponent(teamId)}/competence-plans/${encodeURIComponent(treeId)}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const plan = isRecord(body) ? parsePlan(body.plan) : null;
      return plan === null ? { status: "write_failed" } : { status: "ok", plan };
    }
    if (response.status === 400 && isRecord(body) && body.error === "invalid_input") {
      const issues = Array.isArray(body.issues) ? body.issues.filter((i): i is string => typeof i === "string") : [];
      return { status: "invalid_input", issues };
    }
    return { status: writeFailureStatus(response.status) };
  } catch {
    return { status: "write_failed" };
  }
}
