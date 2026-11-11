"use client";

import { useEffect, useState, type ReactNode } from "react";
import { buildCollaborativeAxes, type CompetenceAreaForProfile } from "../domain/collaborative-profile";
import { automaticOverviewAreas, collaborativeOverviewAreas, type OverviewArea } from "../domain/overview-areas";
import { COLLABORATIVE_PANEL_COPY } from "../copy";
import { OVERVIEW_ADMIN_COPY } from "../overview-copy";
import { useCollaborativeTeamData } from "../client/use-collaborative-team-data";
import { fetchSkillNeeds } from "../../team-skills/client/team-skills-gateway";
import { useCompetencePlans } from "../../team-competence-plan/client/use-competence-plans";
import { KompetanseprofilRadar } from "./KompetanseprofilRadar";
import { AutomaticProfileView, availableAutomaticRows, useAutomaticTeamProfile } from "./TeamCompetenceProfile";
import { CollaborativeLevelEditor, type LevelEditorRow } from "./CollaborativeLevelEditor";
import { CompetenceAreaManager } from "./CompetenceAreaManager";
import { TeamCompetenceOverview } from "./TeamCompetenceOverview";

/**
 * Team's need target per competence tree, from the existing skill-needs read. `null` until loaded or when the read fails:
 * an area then shows no target rather than a made-up one.
 */
function useNeedTargets(token: string | null, teamId: string): Map<string, number> | null {
  const key = token === null ? null : `${teamId}|${token}`;
  const [loaded, setLoaded] = useState<{ key: string; targets: Map<string, number> } | null>(null);

  useEffect(() => {
    if (token === null || key === null) return;
    let cancelled = false;
    void fetchSkillNeeds(token, teamId).then((result) => {
      if (cancelled) return;
      const targets = new Map<string, number>();
      if (result.status === "ok") {
        for (const need of result.needs) {
          if (need.areaAvailable) targets.set(need.treeId, need.requiredLevel);
        }
      }
      setLoaded({ key, targets });
    });
    return () => {
      cancelled = true;
    };
  }, [token, teamId, key]);

  return loaded !== null && loaded.key === key ? loaded.targets : null;
}

/**
 * Teamkompetanse panel. One collection per mode drives every figure on the page:
 * - collaborative: the team's active assigned areas, with the teamadmin-entered levels;
 * - automatic: the numeric rows for the team's needs, which are also the radar's axes.
 * Administration and the detailed sections live in one collapsed container below the overview. Every write is re-checked
 * by the server; `canEdit` only decides which controls are shown.
 */
export function CollaborativeCompetenceProfile({ teamId, detailSections }: { readonly teamId: string; readonly detailSections?: ReactNode }) {
  const { phase, token, current, reload } = useCollaborativeTeamData(teamId);
  const targets = useNeedTargets(token, teamId);
  const plans = useCompetencePlans(teamId);
  const automaticToken = current !== null && current.profile.status === "ok" && current.profile.mode === "automatic" ? token : null;
  const automatic = useAutomaticTeamProfile(teamId, automaticToken);

  if (phase === "loading" || (token !== null && current === null)) {
    return <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.loading}</p>;
  }
  if (phase === "signed_out" || current === null || token === null) {
    return <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.unauthenticated}</p>;
  }
  if (current.profile.status !== "ok" || current.areas.status !== "ok") {
    const refused = current.profile.status === "forbidden" || current.areas.status === "forbidden";
    return <p className="text-sm text-text-secondary">{refused ? COLLABORATIVE_PANEL_COPY.forbidden : COLLABORATIVE_PANEL_COPY.readFailed}</p>;
  }

  const { mode, levels } = current.profile;
  const { areas, canEdit } = current.areas;
  const levelByTree = new Map(levels.map((entry) => [entry.treeId, entry.level]));
  const activeAreas = areas.filter((area) => area.status === "active");
  const plannedTreeIds = new Set(plans.data.phase === "loaded" ? plans.data.plans.map((plan) => plan.treeId) : []);
  const namedActiveAreas = activeAreas.map((area) => ({ treeId: area.treeId, name: area.name }));

  const automaticRows = mode === "automatic" ? availableAutomaticRows(automatic.current) : null;
  let overviewAreas: OverviewArea[];
  if (mode === "automatic" && automaticRows !== null) {
    overviewAreas = automaticOverviewAreas(automaticRows, plannedTreeIds);
  } else {
    overviewAreas = collaborativeOverviewAreas({
      activeAreas: namedActiveAreas,
      levelByTree: mode === "collaborative" ? levelByTree : new Map(),
      levelsAvailable: mode === "collaborative",
      targets,
      plannedTreeIds,
    });
  }

  const profileAreas: CompetenceAreaForProfile[] = activeAreas.map((area) => ({
    treeId: area.treeId,
    label: area.name ?? COLLABORATIVE_PANEL_COPY.unnamedArea,
    status: area.status,
    teamLevel: levelByTree.get(area.treeId) ?? null,
  }));
  const editorRows: LevelEditorRow[] = activeAreas.map((area) => ({
    treeId: area.treeId,
    label: area.name ?? COLLABORATIVE_PANEL_COPY.unnamedArea,
    teamLevel: levelByTree.get(area.treeId) ?? null,
  }));

  const anyLevelSet = profileAreas.some((area) => area.teamLevel !== null);
  const radar =
    mode === "automatic" ? (
      <AutomaticProfileView current={automatic.current} signedOut={false} onRetry={automatic.retry} />
    ) : (
      <div className="flex flex-col gap-4">
        {anyLevelSet ? null : <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.radarEmpty}</p>}
        <KompetanseprofilRadar axes={buildCollaborativeAxes(profileAreas, [])} showTable={false} />
      </div>
    );

  return (
    <section className="flex flex-col gap-8">
      {mode === "automatic" ? <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.automaticHint}</p> : null}
      <TeamCompetenceOverview teamId={teamId} areas={overviewAreas} canEdit={canEdit} mode={mode} radar={radar} />
      <details className="rounded-surface border border-border-subtle bg-surface p-6 shadow-card">
        <summary className="cursor-pointer text-base font-semibold text-text-primary">{OVERVIEW_ADMIN_COPY.heading}</summary>
        <div className="mt-6 flex flex-col gap-8">
          {canEdit ? (
            <>
              <p className="text-sm text-text-secondary">{OVERVIEW_ADMIN_COPY.intro}</p>
              {mode === "collaborative" ? <CollaborativeLevelEditor teamId={teamId} token={token} rows={editorRows} onSaved={reload} /> : null}
              <CompetenceAreaManager teamId={teamId} token={token} areas={areas} onChanged={reload} />
            </>
          ) : null}
          {detailSections}
        </div>
      </details>
    </section>
  );
}
