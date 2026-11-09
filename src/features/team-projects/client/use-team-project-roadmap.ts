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

/** Participations of every active project, read through the TASK-004 API. A failed read is reported, never hidden. */
async function loadParticipations(token: string, teamId: string, projects: ClientTeamProject[]) {
  const active = projects.filter((project) => !project.archived);
  const results = await Promise.all(active.map((project) => fetchProjectParticipations(token, teamId, project.projectId)));
  return {
    participations: results.flatMap((item) => (item.status === "ok" ? item.participations : [])),
    participationsFailed: results.some((item) => item.status !== "ok"),
    truncated: results.some((item) => item.status === "ok" && item.truncated),
  };
}

/**
 * Loads the project roadmap for `teamId` (TASK-005). Project and member reads are independent: a failed member read
 * only drops names. Participations are read per active project through the TASK-004 API; a failed participation read
 * is reported separately and never hides the project list. Responses from a superseded load are dropped.
 *
 * `refreshParticipations` re-reads only the participation timeline after a write, so the loaded page stays on screen
 * and an open management form is not unmounted.
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
      const participations = await loadParticipations(token, teamId, projectsResult.projects);
      return {
        phase: "loaded",
        canEdit: projectsResult.canEdit,
        truncated: projectsResult.truncated || participations.truncated,
        projects: projectsResult.projects,
        members: membersResult.status === "ok" ? membersResult.members : [],
        membersFailed: membersResult.status !== "ok",
        participations: participations.participations,
        participationsFailed: participations.participationsFailed,
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

  /** Re-reads the participations of the loaded projects in place. Ignored unless the page is loaded for this request. */
  async function refreshParticipations(): Promise<void> {
    if (token === null || requestKey === null || data.phase !== "loaded") return;
    const next = await loadParticipations(token, teamId, data.projects);
    setResult((previous) => {
      if (previous === null || previous.requestKey !== requestKey || previous.data.phase !== "loaded") return previous;
      return {
        requestKey,
        data: {
          ...previous.data,
          participations: next.participations,
          participationsFailed: next.participationsFailed,
          truncated: previous.data.truncated || next.truncated,
        },
      };
    });
  }

  return {
    auth,
    data,
    reload: () => setReloadKey((key) => key + 1),
    refreshParticipations,
  };
}
