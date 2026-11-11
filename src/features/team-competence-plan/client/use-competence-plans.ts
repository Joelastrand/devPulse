"use client";

import { useEffect, useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchRoadmapItems } from "../../roadmap/client/roadmap-gateway";
import type { RoadmapItemView } from "../../roadmap/server/list-roadmap-items";
import {
  createCompetencePlan,
  fetchCompetencePlans,
  putCompetencePlan,
  type ClientCompetencePlan,
  type CompetencePlanInput,
  type CompetencePlanWriteResult,
} from "./competence-plan-gateway";

export type CompetencePlanPageData =
  | { phase: "loading" }
  | { phase: "error"; reason: "forbidden" | "read_failed" }
  | {
      phase: "loaded";
      canEdit: boolean;
      truncated: boolean;
      plans: ClientCompetencePlan[];
      /** Existing roadmap competence-stage records, shown read-only and unchanged (BR-17). */
      legacyItems: RoadmapItemView[];
      legacyFailed: boolean;
    };

type AuthState = { phase: "loading" } | { phase: "signed_out" } | { phase: "signed_in"; token: string };

async function load(token: string, teamId: string): Promise<CompetencePlanPageData> {
  const [plansResult, legacyResult] = await Promise.all([
    fetchCompetencePlans(token, teamId, true),
    fetchRoadmapItems(token, teamId, { includeArchived: false }),
  ]);
  if (plansResult.status !== "ok") {
    return { phase: "error", reason: plansResult.status === "forbidden" ? "forbidden" : "read_failed" };
  }
  return {
    phase: "loaded",
    canEdit: plansResult.canEdit,
    truncated: plansResult.truncated,
    plans: plansResult.plans,
    legacyItems: legacyResult.status === "ok" ? legacyResult.items.filter((item) => !item.archived) : [],
    legacyFailed: legacyResult.status !== "ok",
  };
}

/**
 * Loads the team's competence plans (TASK-006). Plans need no competence area. Responses from a superseded load are
 * dropped. A saved plan reloads the page data, so the view never shows a stale plan after a successful write.
 */
export function useCompetencePlans(teamId: string) {
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  // Tagged with the request it answers, so a stale result never matches the current key (no synchronous setState in effect).
  const [result, setResult] = useState<{ requestKey: string; data: CompetencePlanPageData } | null>(null);

  useAuthGatedResource(
    (token) => {
      setAuth(token ? { phase: "signed_in", token } : { phase: "signed_out" });
    },
    [teamId],
  );

  const token = auth.phase === "signed_in" ? auth.token : null;
  const requestKey = token === null ? null : `${teamId}\u0000${reloadKey}\u0000${token}`;

  useEffect(() => {
    if (token === null || requestKey === null) return;
    let cancelled = false;
    load(token, teamId).then((data) => {
      if (!cancelled) setResult({ requestKey, data });
    });
    return () => {
      cancelled = true;
    };
  }, [requestKey, token, teamId]);

  const data: CompetencePlanPageData =
    result !== null && result.requestKey === requestKey ? result.data : { phase: "loading" };

  async function create(input: CompetencePlanInput): Promise<CompetencePlanWriteResult> {
    if (token === null) return { status: "unauthenticated" };
    const outcome = await createCompetencePlan(token, teamId, input);
    if (outcome.status === "ok") setReloadKey((key) => key + 1);
    return outcome;
  }

  async function save(planId: string, input: CompetencePlanInput): Promise<CompetencePlanWriteResult> {
    if (token === null) return { status: "unauthenticated" };
    const outcome = await putCompetencePlan(token, teamId, planId, input);
    if (outcome.status === "ok") setReloadKey((key) => key + 1);
    return outcome;
  }

  /**
   * Marks one milestone completed or open through the same plan PUT as the editor. On success the returned plan replaces
   * the loaded one in place, so the page does not reload and every progress view derives from the one saved plan.
   */
  async function saveMilestoneCompletion(
    planId: string,
    milestoneId: string,
    completed: boolean,
  ): Promise<CompetencePlanWriteResult> {
    if (token === null || requestKey === null) return { status: "unauthenticated" };
    const current = data.phase === "loaded" ? data.plans.find((plan) => plan.planId === planId) : undefined;
    if (current === undefined) return { status: "write_failed" };
    const input: CompetencePlanInput = {
      title: current.title,
      targetStage: current.targetStage,
      priority: current.priority,
      archived: current.archived,
      milestones: current.milestones.map((milestone): CompetencePlanInput["milestones"][number] =>
        milestone.id === milestoneId
          ? { id: milestone.id, title: milestone.title, targetDate: milestone.targetDate, status: completed ? "completed" : "in_progress" }
          : { id: milestone.id, title: milestone.title, targetDate: milestone.targetDate, status: milestone.status },
      ),
    };
    const outcome = await putCompetencePlan(token, teamId, planId, input);
    if (outcome.status === "ok") {
      const saved = outcome.plan;
      setResult((previous) => {
        if (previous === null || previous.requestKey !== requestKey || previous.data.phase !== "loaded") return previous;
        const plans = previous.data.plans.map((plan) => (plan.planId === planId ? saved : plan));
        return { requestKey: previous.requestKey, data: { ...previous.data, plans } };
      });
    }
    return outcome;
  }

  return { data, create, save, saveMilestoneCompletion, reload: () => setReloadKey((key) => key + 1) };
}
