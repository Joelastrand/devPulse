"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamsOverview } from "../../teams/client/teams-overview-gateway";
import { TeamRouteNav } from "../../teams/components/TeamRouteNav";
import { teamsCopy } from "../../teams/copy";
import { useRoadmapPageData } from "../client/use-roadmap-page-data";
import { useRoadmapView } from "../client/use-roadmap-view";
import { roadmapCopy } from "../copy";
import {
  DEFAULT_ROADMAP_FILTER,
  eligibleRoadmapAreas,
  filterRoadmapItems,
  summarizeRoadmapItems,
  type RoadmapFilter,
  type RoadmapSummary,
} from "../domain/roadmap-filter";
import { RoadmapFilterBar } from "./RoadmapFilterBar";
import type { RoadmapEditing } from "./RoadmapPlanCard";
import { RoadmapListView } from "./RoadmapListView";
import { RoadmapTimelineView } from "./RoadmapTimelineView";
import { RoadmapUnplannedAreas } from "./RoadmapUnplannedAreas";
import { RoadmapViewSwitch } from "./RoadmapViewSwitch";

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "signed_in"; token: string; name?: string };

/**
 * `/teams/[teamId]/roadmap` shell (docs/features/team-roadmap/SPEC.md — BR-1,
 * BR-2, BR-3, BR-4). Route foundation: auth gating, the shared team
 * navigation, the link back to Kompetanseområder and a best-effort team-name
 * heading. The name comes from the existing teams-overview read and is purely
 * presentational: a failed read, or a team absent from the response, leaves
 * the generic heading and never blocks the shell. Absence from the overview is
 * not an access decision — the authoritative no-access state belongs to the
 * roadmap read (TASK-006). The roadmap and skills reads live in `RoadmapContent` (TASK-006).
 */
export function RoadmapPage({ teamId }: { teamId: string }) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });

  useAuthGatedResource(
    (token, generation, isCurrentGeneration) => {
      if (!token) {
        setState({ phase: "signed_out" });
        return;
      }

      setState({ phase: "signed_in", token });
      fetchTeamsOverview(token).then((overview) => {
        if (!isCurrentGeneration(generation) || overview.status !== "ok") {
          return;
        }
        const name = overview.teams.find((team) => team.teamId === teamId)?.name;
        if (name) {
          setState({ phase: "signed_in", token, name });
        }
      });
    },
    [teamId],
  );

  if (state.phase === "loading") {
    return <LoadingState label={teamsCopy.detail.loading} />;
  }

  if (state.phase === "signed_out") {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
          {teamsCopy.detail.signInLink}
        </Link>{" "}
        {teamsCopy.detail.signInPrompt}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={state.name ?? teamsCopy.detail.fallbackName} />
      <TeamRouteNav teamId={teamId} />
      <Link
        href={`/teams/${encodeURIComponent(teamId)}#team-skill-section-heading`}
        className="w-fit font-medium text-zinc-900 underline dark:text-zinc-50"
      >
        {roadmapCopy.openSkills}
      </Link>
      <Suspense fallback={<LoadingState label={roadmapCopy.loading} />}>
        <RoadmapContent key={`${state.token}:${teamId}`} token={state.token} teamId={teamId} />
      </Suspense>
    </div>
  );
}

/**
 * Roadmap read shell (TASK-006). Holds the complete archived-inclusive dataset
 * in the planning controller and derives the default list from it; nothing is
 * dropped from the canonical data. The access decision comes only from the
 * roadmap read. A skills failure is scoped: plans stay rendered, no mutation
 * control exists, and retry refetches the skills read only.
 */
function RoadmapContent({ token, teamId }: { token: string; teamId: string }) {
  const { planning, skills, retrySkills, canMutate } = useRoadmapPageData({ token, teamId });
  const { roadmap } = planning;
  const [retrying, setRetrying] = useState(false);
  // Transient page-level presentation state (SPEC BR-14, BR-16): never persisted, never in the URL.
  const [filter, setFilter] = useState<RoadmapFilter>(DEFAULT_ROADMAP_FILTER);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  // The only URL state: `?view=timeline` (SPEC BR-13).
  const { view, setView } = useRoadmapView();
  const { page } = roadmapCopy;

  if (roadmap.phase === "loading") {
    return <LoadingState label={roadmapCopy.loading} />;
  }

  if (roadmap.phase === "forbidden") {
    return (
      <div className="flex flex-col gap-2">
        <Alert variant="error">{page.noAccess}</Alert>
        <Link
          href={`/teams/${encodeURIComponent(teamId)}`}
          className="w-fit font-medium text-zinc-900 underline dark:text-zinc-50"
        >
          {page.backToTeam}
        </Link>
      </div>
    );
  }

  if (roadmap.phase === "error") {
    return (
      <div className="flex flex-col items-start gap-2">
        <Alert variant="error">{page.readError}</Alert>
        <Button
          variant="secondary"
          size="sm"
          pending={retrying}
          onClick={() => {
            setRetrying(true);
            planning.refresh().finally(() => setRetrying(false));
          }}
        >
          {page.retry}
        </Button>
      </div>
    );
  }

  // The canonical archived-inclusive dataset is never replaced: the summary reads all of it,
  // the list reads a filtered derivation.
  const canonical = roadmap.items;
  const summary = summarizeRoadmapItems(canonical);
  const visible = filterRoadmapItems(canonical, filter);
  const hasNonArchived = summary.total > 0;

  // Controls exist only when the page can mutate; the actions are the shared controller's, so a
  // successful write refetches the one archived-inclusive read and nothing is patched locally.
  const editing: RoadmapEditing | null =
    canMutate && skills.phase === "loaded"
      ? {
          trackedAreas: skills.skills,
          actions: {
            token,
            teamId,
            refresh: planning.refresh,
            owners: planning.owners,
            loadOwners: planning.loadOwners,
          },
        }
      : null;

  // Eligibility reads only the skills-read areas and the complete canonical response, never the
  // filtered/visible set. A truncated response may omit a plan for an area, so creation is not
  // offered then (the server's already_planned stays the authority, but we do not invite the miss).
  const eligibleAreas =
    editing && !roadmap.truncated ? eligibleRoadmapAreas(editing.trackedAreas, canonical) : [];
  const unplanned =
    editing && eligibleAreas.length > 0 ? (
      <RoadmapUnplannedAreas areas={eligibleAreas} actions={editing.actions} />
    ) : null;

  function changeFilter(next: RoadmapFilter) {
    if (next.status === "completed" && filter.status !== "completed") setCompletedExpanded(true);
    setFilter(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{page.currentPlanHelp}</p>
      {roadmap.truncated && <Alert variant="info">{page.truncated}</Alert>}
      {skills.phase === "loading" && <LoadingState label={page.skillsLoading} />}
      {skills.phase === "error" && (
        <div className="flex flex-col items-start gap-2">
          <Alert variant="error">{page.skillsError}</Alert>
          <Button variant="secondary" size="sm" onClick={retrySkills}>
            {page.skillsRetry}
          </Button>
        </div>
      )}
      {canonical.length === 0 ? (
        <>
          <EmptyState>{page.noPlans}</EmptyState>
          {unplanned}
        </>
      ) : (
        <>
          {hasNonArchived && <p className="text-sm text-zinc-700 dark:text-zinc-300">{summaryLine(summary)}</p>}
          <RoadmapViewSwitch view={view} onChange={setView} />
          <RoadmapFilterBar filter={filter} onChange={changeFilter} />
          {visible.length === 0 ? (
            !hasNonArchived && !filter.showArchived ? (
              <EmptyState>{roadmapCopy.filters.allArchivedHint}</EmptyState>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <EmptyState>{roadmapCopy.filters.noMatch}</EmptyState>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setFilter({ ...filter, status: "all", priority: "all" })}
                >
                  {roadmapCopy.filters.clear}
                </Button>
              </div>
            )
          ) : view === "timeline" ? (
            <RoadmapTimelineView
              items={visible}
              editing={editing}
              completedExpanded={completedExpanded}
              onToggleCompleted={() => setCompletedExpanded((expanded) => !expanded)}
            />
          ) : (
            <RoadmapListView
              items={visible}
              editing={editing}
              completedExpanded={completedExpanded}
              onToggleCompleted={() => setCompletedExpanded((expanded) => !expanded)}
            />
          )}
          {unplanned}
        </>
      )}
    </div>
  );
}

function summaryLine(summary: RoadmapSummary): string {
  const { summary: copy } = roadmapCopy;
  const parts = [
    `${summary.active} ${copy.active}`,
    `${summary.planned} ${copy.planned}`,
    `${summary.completed} ${copy.completed}`,
  ];
  if (summary.overdue > 0) parts.push(`${summary.overdue} ${copy.overdue}`);
  return `${copy.prefix} ${parts.join(" · ")}`;
}
