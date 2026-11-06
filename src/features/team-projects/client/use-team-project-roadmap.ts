"use client";

import { useEffect, useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import type { ProjectParticipationView } from "../server/write-project-participation";
import {
  fetchAssignableMembers,
  fetchProjectParticipations,
  fetchTeamProjects,
  type ClientMember,
  type ClientTeamProject,
} from "./team-projects-gateway";

export type RoadmapData =
  | { phase: "loading" }
  | { phase: "error"; reason: "forbidden" | "read_failed" }
  | {
      phase: "loaded";
      canEdit: boolean;
      truncated: boolean;
      projects: ClientTeamProject[];
      /** Empty when the member read failed; participation then renders without names. */
      members: ClientMember[];
      membersFailed: boolean;
      /** Participations of the active projects only. */
      participations: ProjectParticipationView[];
      participationsFailed: boolean;
    };

type AuthState = { phase: "loading" } | { phase: "signed_out" } | { phase: "signed_in"; token: string };

/**
 * Loads the project roadmap for `teamId` (TASK-005). Project and member reads are independent: a failed member read
 * only drops names. Participations are read per active project through the TASK-004 API; a failed participation read
 * is reported separately and never hides the project list. Responses from a superseded load are dropped.
 */
export function useTeamProjectRoadmap(teamId: string) {
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  // Each result is tagged with the request it answers. A result for an earlier request never matches the current key,
  // so the view shows loading instead of stale data, without calling setState synchronously inside the effect.
  const [result, setResult] = useState<{ requestKey: string; data: RoadmapData } | null>(null);

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

    async function load(token: string): Promise<RoadmapData> {
      const [projectsResult, membersResult] = await Promise.all([
        fetchTeamProjects(token, teamId),
        fetchAssignableMembers(token, teamId),
      ]);
      if (projectsResult.status !== "ok") {
        return { phase: "error", reason: projectsResult.status === "forbidden" ? "forbidden" : "read_failed" };
      }
      const active = projectsResult.projects.filter((project) => !project.archived);
      const participationResults = await Promise.all(
        active.map((project) => fetchProjectParticipations(token, teamId, project.projectId)),
      );
      const participations = participationResults.flatMap((item) => (item.status === "ok" ? item.participations : []));
      return {
        phase: "loaded",
        canEdit: projectsResult.canEdit,
        truncated: projectsResult.truncated || participationResults.some((item) => item.status === "ok" && item.truncated),
        projects: projectsResult.projects,
        members: membersResult.status === "ok" ? membersResult.members : [],
        membersFailed: membersResult.status !== "ok",
        participations,
        participationsFailed: participationResults.some((item) => item.status !== "ok"),
      };
    }

    load(token).then((next) => {
      if (!cancelled) setResult({ requestKey, data: next });
    });
    return () => {
      cancelled = true;
    };
  }, [token, requestKey, teamId]);

  const data: RoadmapData =
    requestKey !== null && result?.requestKey === requestKey ? result.data : { phase: "loading" };

  return {
    auth,
    data,
    reload: () => setReloadKey((key) => key + 1),
  };
}
