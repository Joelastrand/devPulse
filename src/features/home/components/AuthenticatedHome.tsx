"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageShell } from "../../../components/ui/PageShell";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchGoals } from "../../personal-goals/client/goals-gateway";
import type { GoalDto } from "../../personal-goals/domain/goal";
import { fetchConversationList, type OwnerSummaryWire } from "../../development-conversations/client/conversations-gateway";
import { fetchOwnProfile } from "../../profiles/client/profile-gateway";
import { fetchTeamResults, type SurveyResultSummary } from "../../results/client/team-results-gateway";
import { fetchTeamsOverview } from "../../teams/client/teams-overview-gateway";
import type { TeamOverviewEntry } from "../../teams/client/teams-overview-gateway";
import { authenticatedHomeCopy } from "../copy";
import {
  firstMemberTeamId,
  GoalsPanel,
  NextConversationPanel,
  NextStepsPanel,
  QuickLinks,
  Read,
  TeamDevelopmentPanel,
  TeamEntryTile,
  TeamPulseTile,
  TeamsSection,
} from "./HomePanels";

const copy = authenticatedHomeCopy;

const LOADING: { phase: "loading" } = { phase: "loading" };

/**
 * Authenticated home (docs/design/references/03-app-home.png, visual-redesign
 * SPEC BR-12). Rendered only inside `AppShell` after the client has a signed-in
 * token. Every value comes from an existing read the viewer may already make.
 * Each section loads and fails on its own, so one failed read never hides
 * another panel. No new endpoint or field is added.
 */
export function AuthenticatedHome() {
  const [displayName, setDisplayName] = useState<Read<string | null>>(LOADING);
  const [goals, setGoals] = useState<Read<GoalDto[]>>(LOADING);
  const [conversations, setConversations] = useState<Read<OwnerSummaryWire[]>>(LOADING);
  const [teams, setTeams] = useState<Read<TeamOverviewEntry[]>>(LOADING);
  const [teamResults, setTeamResults] = useState<Read<SurveyResultSummary[]>>(LOADING);
  // Re-runs the teams read for the current auth generation; set by the auth callback below.
  const refreshTeamsRef = useRef<(() => void) | null>(null);
  const handleTeamsChanged = useCallback(() => refreshTeamsRef.current?.(), []);
  const teamId = teams.phase === "ok" ? firstMemberTeamId(teams.value) : null;
  // The team id the panel should show now. A response for any other team is dropped (see below).
  const currentTeamIdRef = useRef<string | null>(teamId);
  useEffect(() => {
    currentTeamIdRef.current = teamId;
  }, [teamId]);

  useAuthGatedResource((token, generation, isCurrentGeneration) => {
    if (token === null) {
      refreshTeamsRef.current = null;
      return;
    }
    setDisplayName(LOADING);
    setGoals(LOADING);
    setConversations(LOADING);
    setTeams(LOADING);

    void fetchOwnProfile(token).then((result) => {
      if (!isCurrentGeneration(generation)) return;
      setDisplayName(result.status === "ok" ? { phase: "ok", value: result.displayName } : { phase: "error" });
    }, () => {
      if (isCurrentGeneration(generation)) setDisplayName({ phase: "error" });
    });
    void fetchGoals(token).then((result) => {
      if (!isCurrentGeneration(generation)) return;
      setGoals(result.status === "ok" ? { phase: "ok", value: result.response.goals } : { phase: "error" });
    }, () => {
      if (isCurrentGeneration(generation)) setGoals({ phase: "error" });
    });
    void fetchConversationList(token).then((result) => {
      if (!isCurrentGeneration(generation)) return;
      if (result.status !== "ok") {
        setConversations({ phase: "error" });
        return;
      }
      const owned = result.response.owned.items.flatMap((item) => (item.kind === "summary" ? [item.conversation] : []));
      setConversations({ phase: "ok", value: owned });
    }, () => {
      if (isCurrentGeneration(generation)) setConversations({ phase: "error" });
    });
    // Shared by the initial load and the post-request-access refresh; neither adds a read beyond this one.
    const loadTeams = () => {
      void fetchTeamsOverview(token).then((result) => {
        if (!isCurrentGeneration(generation)) return;
        setTeams(result.status === "ok" ? { phase: "ok", value: result.teams } : { phase: "error" });
      }, () => {
        if (isCurrentGeneration(generation)) setTeams({ phase: "error" });
      });
    };
    refreshTeamsRef.current = loadTeams;
    loadTeams();
  });

  // The team results read is the one the team development chart and the pulse card share.
  // It runs once per team id; it is not a new read.
  useAuthGatedResource(
    (token, generation, isCurrentGeneration) => {
      if (token === null || teamId === null) {
        setTeamResults({ phase: "ok", value: [] });
        return;
      }
      setTeamResults(LOADING);
      void fetchTeamResults(token, teamId).then((result) => {
        // Apply only if this auth generation is still current and the viewer's team is still the one requested.
        if (!isCurrentGeneration(generation) || currentTeamIdRef.current !== teamId) return;
        setTeamResults(result.status === "ok" ? { phase: "ok", value: result.results } : { phase: "error" });
      }, () => {
        if (isCurrentGeneration(generation) && currentTeamIdRef.current === teamId) setTeamResults({ phase: "error" });
      });
    },
    [teamId],
  );

  const greetingName = displayName.phase === "ok" && displayName.value ? displayName.value : null;

  return (
    <PageShell width="wide">
      <section className="rounded-surface border border-border-subtle bg-surface px-6 py-8 shadow-card md:px-8 md:py-10">
        <div className="flex max-w-xl flex-col gap-2">
          <h1 className="text-metric font-semibold text-text-primary">
            {greetingName ? copy.greeting.withName(greetingName) : copy.title}
          </h1>
          <p className="text-body text-text-secondary">{copy.greeting.context}</p>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <TeamEntryTile read={teams} />
        <TeamPulseTile teams={teams} teamId={teamId} results={teamResults} />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <GoalsPanel goals={goals} />
        <NextConversationPanel conversations={conversations} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TeamDevelopmentPanel teams={teams} teamId={teamId} results={teamResults} />
        <NextStepsPanel />
      </div>

      <div className="mt-8 flex flex-col gap-8">
        <QuickLinks />
        <TeamsSection teams={teams} onTeamsChanged={handleTeamsChanged} />
      </div>
    </PageShell>
  );
}
