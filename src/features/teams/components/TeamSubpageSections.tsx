"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamSkills, type FetchTeamSkillsResult } from "../../skill-trees/client/skill-trees-gateway";
import { TeamSkillSection, type TeamSkillSectionState } from "../../skill-trees/components/TeamSkillSection";
import { RoadmapPlanningScope } from "../../roadmap/components/RoadmapPlanning";
import { TeamSkillNeedsSection } from "../../team-skills/components/TeamSkillNeedsSection";
import { teamsCopy } from "../copy";
import { TeamRosterSection } from "./TeamRosterSection";
import { TeamVisibilitySettings } from "./TeamVisibilitySettings";

/**
 * Client gate for the authorized sections that now live on their own team sub-pages (Teamkompetanse, Kompetanseplan,
 * Teaminnstillinger). Each section still loads its own authorized data through its existing gateway; this gate only
 * supplies the current id token and remounts the subtree on every auth change, so a stale response from a superseded
 * identity can never render (mirrors `useAuthGatedResource`'s generation guard).
 */
function TeamAuthSection({ children }: { children: (token: string) => ReactNode }) {
  const [state, setState] = useState<{ phase: "loading" } | { phase: "signed_out" } | { phase: "signed_in"; token: string; generation: number }>({
    phase: "loading",
  });

  useAuthGatedResource((token, generation) => {
    setState(token ? { phase: "signed_in", token, generation } : { phase: "signed_out" });
  });

  if (state.phase === "loading") {
    return null;
  }
  if (state.phase === "signed_out") {
    return (
      <p className="text-text-secondary">
        <Link href="/sign-in" className="font-medium text-text-primary underline">
          {teamsCopy.detail.signInLink}
        </Link>{" "}
        {teamsCopy.detail.signInPrompt}
      </p>
    );
  }
  return <div key={state.generation}>{children(state.token)}</div>;
}

function toSkillSectionState(result: FetchTeamSkillsResult): TeamSkillSectionState {
  return result.status === "ok"
    ? { status: "loaded", skills: result.skills, canReportProgress: result.canReportProgress }
    : { status: "error" };
}

/** Tracked competence areas with self-report and roadmap plan summaries. Lives on Teamkompetanse. */
function TeamSkillTracking({ teamId, token }: { teamId: string; token: string }) {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<TeamSkillSectionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetchTeamSkills(token, teamId).then((result) => {
      if (!cancelled) {
        setState(toSkillSectionState(result));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, teamId, reload]);

  return (
    <RoadmapPlanningScope token={token} teamId={teamId}>
      {(planning) => (
        <TeamSkillSection
          idToken={token}
          teamId={teamId}
          state={state}
          onReported={() => setReload((count) => count + 1)}
          planning={planning}
        />
      )}
    </RoadmapPlanningScope>
  );
}

/** Teamkompetanse: the team's tracked competence areas. */
export function TeamSkillTrackingSection({ teamId }: { teamId: string }) {
  return <TeamAuthSection>{(token) => <TeamSkillTracking teamId={teamId} token={token} />}</TeamAuthSection>;
}

/** Kompetanseplan: competence needs and coverage for the team. */
export function TeamCompetenceNeedsSection({ teamId }: { teamId: string }) {
  return <TeamAuthSection>{(token) => <TeamSkillNeedsSection teamId={teamId} token={token} />}</TeamAuthSection>;
}

/** Teaminnstillinger: member roster and team visibility controls. */
export function TeamSettingsSections({ teamId }: { teamId: string }) {
  return (
    <TeamAuthSection>
      {(token) => (
        <div className="flex flex-col gap-6">
          <TeamRosterSection teamId={teamId} token={token} />
          <TeamVisibilitySettings teamId={teamId} token={token} />
        </div>
      )}
    </TeamAuthSection>
  );
}
