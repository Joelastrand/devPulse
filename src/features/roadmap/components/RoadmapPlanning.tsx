"use client";

import type { ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useRoadmapPlanning, type OwnersState } from "../client/use-roadmap-planning";
import { roadmapCopy } from "../copy";
import type { StageNode } from "../domain/roadmap-form";
import { compareRoadmapPlans, orderAreasForPlanning } from "../domain/roadmap-sort";
import type { RoadmapItemView } from "../server/list-roadmap-items";
import { AreaPlanEditor } from "./RoadmapPlanEditor";

export type { OwnersState };

/** What the planning UI needs to know about one tracked competency area. */
export interface PlanningArea {
  treeId: string;
  name: string;
  currentNodeId: string | null;
  nodes: StageNode[];
}

/** Shared operations the per-area editor uses; all of them act on the one planning scope. */
export interface PlanningActions {
  token: string;
  teamId: string;
  /** Refetches the canonical GET(s). Resolves `true` only when every needed refetch succeeded. */
  refresh(): Promise<boolean>;
  owners: OwnersState;
  /** Loads the owner dataset once; `force` reloads it (e.g. after `invalid_owner`). */
  loadOwners(force?: boolean): void;
}

/** What `TeamSkillSection` needs to place plans inside its area rows. */
export interface AreaPlanning {
  orderAreas<A extends { treeId: string; name: string }>(areas: A[]): A[];
  renderAreaPlan(area: PlanningArea): ReactNode;
  controls: ReactNode;
  /** Plans whose area the team no longer tracks (`tracking.state === "not_tracked"`); `null` when none. */
  untracked: ReactNode;
}

/**
 * Owns the roadmap read for `/teams/[teamId]` (docs/features/
 * team-skill-planning/SPEC.md — BR-32): one fetch on mount with its own
 * loading/error state, so a roadmap failure never touches the other sections.
 * Plans are matched to areas by `treeId` only. Archived plans are requested
 * (`?archived=true`) only when "Vis arkiverte" is switched on; with it off
 * they are never shown. Fetched plans for areas that are not rendered here
 * (untracked) stay in state untouched. Remount with a new `key` when the auth
 * identity changes.
 *
 * Writes (TASK-009) never update this state directly: after a successful
 * mutation the editor calls `refresh()`, which refetches the canonical GET
 * (plus the archived-inclusive GET while "Vis arkiverte" is on). A failed
 * refresh keeps the previous state and reports `false`. Results of a request
 * started under an earlier `token`/`teamId` are dropped (epoch check). The
 * owner dataset is fetched at most once per scope, on the first form open.
 */
export function RoadmapPlanningScope({
  token,
  teamId,
  children,
}: {
  token: string;
  teamId: string;
  children: (planning: AreaPlanning) => ReactNode;
}) {
  const { roadmap: base, archived, showArchived, hideArchived, refresh, owners, loadOwners } = useRoadmapPlanning({
    token,
    teamId,
    mode: "lazy-archived",
  });

  const archivedOn = archived.phase !== "off";
  const baseItems = base.phase === "loaded" ? base.items : [];
  const canEdit = base.phase === "loaded" && base.canEdit;
  const visibleItems = archived.phase === "loaded" ? archived.items : baseItems.filter((item) => !item.archived);
  // Tracking state comes from the DTO, never from whether an area row happens to render, so a plan
  // is shown in its tracked area row or in the untracked section, never both.
  const trackedItems = visibleItems.filter((item) => item.tracking.state === "tracked");
  const untrackedItems = visibleItems
    .filter((item) => item.tracking.state === "not_tracked")
    .sort(compareRoadmapPlans);
  const planByTree = new Map<string, RoadmapItemView>();
  for (const item of trackedItems) {
    if (!planByTree.has(item.treeId)) planByTree.set(item.treeId, item);
  }
  const actions: PlanningActions = { token, teamId, refresh, owners, loadOwners };

  const planning: AreaPlanning = {
    orderAreas: (areas) =>
      base.phase === "loaded"
        ? orderAreasForPlanning(
            areas,
            trackedItems.filter((item) => !item.archived),
          )
        : areas,
    renderAreaPlan: (area) => {
      if (base.phase === "loading") return <LoadingState label={roadmapCopy.loading} />;
      if (base.phase === "error" || base.phase === "forbidden") {
        return (
          <Alert variant="error" className="text-sm">
            {roadmapCopy.error}
          </Alert>
        );
      }
      // Existence comes from the fetched state (completed plans included), never from a display filter.
      return <AreaPlanEditor area={area} plan={planByTree.get(area.treeId)} canEdit={canEdit} actions={actions} />;
    },
    untracked:
      base.phase !== "loaded" || untrackedItems.length === 0 ? null : (
        <section aria-labelledby="untracked-plans-heading" className="flex flex-col gap-2">
          <h3 id="untracked-plans-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {roadmapCopy.untracked.heading}
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{roadmapCopy.untracked.explanation}</p>
          <ul className="flex flex-col gap-3">
            {untrackedItems.map((item) => {
              const name = item.areaName ?? roadmapCopy.untracked.unnamedArea;
              return (
                <li
                  key={item.treeId}
                  className="flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <p className="break-words font-medium text-zinc-900 dark:text-zinc-50">{name}</p>
                  <AreaPlanEditor
                    area={{ treeId: item.treeId, name, currentNodeId: null, nodes: [] }}
                    plan={item}
                    canEdit={canEdit}
                    actions={actions}
                    targetLocked
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ),
    controls:
      base.phase !== "loaded" ? null : (
        <div className="flex flex-col items-start gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={archivedOn}
            onClick={() => (archivedOn ? hideArchived() : showArchived())}
          >
            {archivedOn ? roadmapCopy.toggles.hideArchived : roadmapCopy.toggles.showArchived}
          </Button>
          {archived.phase === "loading" && <LoadingState label={roadmapCopy.toggles.archivedLoading} />}
          {archived.phase === "error" && (
            <Alert variant="error" className="text-sm">
              {roadmapCopy.toggles.archivedError}
            </Alert>
          )}
        </div>
      ),
  };

  return <>{children(planning)}</>;
}
