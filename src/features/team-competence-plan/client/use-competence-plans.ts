"use client";

import { useEffect, useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchRoadmapItems } from "../../roadmap/client/roadmap-gateway";
import type { RoadmapItemView } from "../../roadmap/server/list-roadmap-items";
import {
  fetchCompetenceAreas,
  fetchCompetencePlans,
  putCompetencePlan,
  type ClientCompetenceArea,
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
      /** Assigned areas (not archived). Empty when the area read failed; plans then render with a fallback name. */
      areas: ClientCompetenceArea[];
      /** Existing roadmap competence-stage records, shown read-only and unchanged (BR-17). */
      legacyItems: RoadmapItemView[];
      legacyFailed: boolean;
    };

type AuthState = { phase: "loading" } | { phase: "signed_out" } | { phase: "signed_in"; token: string };

async function load(token: string, teamId: string): Promise<CompetencePlanPageData> {
  const [plansResult, areasResult, legacyResult] = await Promise.all([
    fetchCompetencePlans(token, teamId, true),
    fetchCompetenceAreas(token, teamId),
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
    areas: areasResult.status === "ok" ? areasResult.areas.filter((area) => area.status !== "archived") : [],
    legacyItems: legacyResult.status === "ok" ? legacyResult.items.filter((item) => !item.archived) : [],
    legacyFailed: legacyResult.status !== "ok",
  };
}

/**
 * Loads the team's competence plans and assigned areas (TASK-006). Responses from a superseded load are dropped. A saved
 * plan reloads the page data, so the view never shows a stale plan after a successful write.
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

  async function save(treeId: string, input: CompetencePlanInput): Promise<CompetencePlanWriteResult> {
    if (token === null) return { status: "unauthenticated" };
    const outcome = await putCompetencePlan(token, teamId, treeId, input);
    if (outcome.status === "ok") setReloadKey((key) => key + 1);
    return outcome;
  }

  return { data, save, reload: () => setReloadKey((key) => key + 1) };
}
