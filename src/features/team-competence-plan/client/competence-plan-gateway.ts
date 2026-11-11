import type { SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { isSelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { isRoadmapPriority, type RoadmapPriority } from "../../roadmap/domain/roadmap-item";
import { isMilestoneStatus, type MilestoneStatus } from "../domain/competence-plan";

/**
 * Client gateway for the team competence plan API. Thin `fetch` wrappers: no Firestore access. Responses are rebuilt
 * field by field, so unexpected keys are dropped. The server is the authorization boundary.
 */

export interface ClientMilestone {
  id: string;
  title: string;
  targetDate: string | null;
  status: MilestoneStatus;
}

export interface ClientCompetencePlan {
  planId: string;
  title: string;
  /** Optional catalog label kept from earlier plans. `null` for plans created now; never used to gate or link a plan. */
  treeId: string | null;
  targetStage: SelfAssessedLevel;
  priority: RoadmapPriority;
  archived: boolean;
  milestones: ClientMilestone[];
  progress: { completed: number; total: number };
}

export type ClientReadStatus = "unauthenticated" | "forbidden" | "read_failed";

export type CompetencePlanListResult =
  | { status: "ok"; plans: ClientCompetencePlan[]; canEdit: boolean; truncated: boolean }
  | { status: ClientReadStatus };

export interface CompetencePlanInput {
  title: string;
  targetStage: SelfAssessedLevel;
  priority: RoadmapPriority;
  archived: boolean;
  milestones: { id?: string; title: string; targetDate: string | null; status: MilestoneStatus }[];
}

export type CompetencePlanWriteResult =
  | { status: "ok"; plan: ClientCompetencePlan }
  | { status: "invalid_input"; issues: string[] }
  | { status: "unauthenticated" | "forbidden" | "not_found" | "conflict" | "write_failed" };

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
    typeof value.planId !== "string" ||
    value.planId.length === 0 ||
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    (value.treeId !== null && (typeof value.treeId !== "string" || value.treeId.length === 0)) ||
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
    planId: value.planId,
    title: value.title,
    treeId: value.treeId as string | null,
    targetStage: value.targetStage,
    priority: value.priority,
    archived: value.archived,
    milestones,
    progress: { completed: value.progress.completed, total: value.progress.total },
  };
}

function readFailureStatus(status: number): ClientReadStatus {
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

async function readWriteResponse(response: Response): Promise<CompetencePlanWriteResult> {
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
}

/** Creates a plan. No competence area is needed. */
export async function createCompetencePlan(idToken: string, teamId: string, input: CompetencePlanInput): Promise<CompetencePlanWriteResult> {
  try {
    const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/competence-plans`, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return await readWriteResponse(response);
  } catch {
    return { status: "write_failed" };
  }
}

/** Replaces the editable fields of one existing plan. */
export async function putCompetencePlan(
  idToken: string,
  teamId: string,
  planId: string,
  input: CompetencePlanInput,
): Promise<CompetencePlanWriteResult> {
  try {
    const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/competence-plans/${encodeURIComponent(planId)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return await readWriteResponse(response);
  } catch {
    return { status: "write_failed" };
  }
}
