"use client";

import { useEffect, useRef, useState } from "react";
import { fetchTeamSkills, type TeamSkillView } from "../../skill-trees/client/skill-trees-gateway";
import { useRoadmapPlanning, type RoadmapPlanningController } from "./use-roadmap-planning";

export type TeamSkillsState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "loaded"; skills: TeamSkillView[] };

export interface RoadmapPageData {
  /** Roadmap read + refresh + owners. `planning.roadmap.items` is the complete archived-inclusive dataset. */
  planning: RoadmapPlanningController;
  /** Tracked areas: exactly what the existing team skills read returned. Independent failure domain. */
  skills: TeamSkillsState;
  /** Refetches only the skills read; never touches the roadmap read. */
  retrySkills(): void;
  /** Page-level mutation capability for later tasks: `canEdit` from the roadmap read AND skills loaded. */
  canMutate: boolean;
}

/**
 * Data foundation of `/teams/[teamId]/roadmap`: one archived-inclusive roadmap
 * read (TASK-002 controller) and the team skills read, loaded alongside each
 * other and failing independently (SPEC BR-7, BR-8, BR-25). Responses of a
 * skills request started under an earlier `token`/`teamId`/retry are dropped.
 */
export function useRoadmapPageData({ token, teamId }: { token: string; teamId: string }): RoadmapPageData {
  const planning = useRoadmapPlanning({ token, teamId, mode: "archived-inclusive" });
  const [skills, setSkills] = useState<TeamSkillsState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const latestAttemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetchTeamSkills(token, teamId).then((result) => {
      if (cancelled || latestAttemptRef.current !== attempt) return;
      setSkills(result.status === "ok" ? { phase: "loaded", skills: result.skills } : { phase: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [token, teamId, attempt]);

  function retrySkills() {
    latestAttemptRef.current = attempt + 1;
    setSkills({ phase: "loading" });
    setAttempt(attempt + 1);
  }

  const canMutate = planning.roadmap.phase === "loaded" && planning.roadmap.canEdit && skills.phase === "loaded";
  return { planning, skills, retrySkills, canMutate };
}
