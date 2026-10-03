"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { LoadingState } from "../../../components/ui/LoadingState";
import {
  fetchAssignableMembers,
  fetchRoadmapItems,
  type AssignableMemberOption,
} from "../client/roadmap-gateway";
import { roadmapCopy } from "../copy";
import type { StageNode } from "../domain/roadmap-form";
import { compareRoadmapPlans, orderAreasForPlanning } from "../domain/roadmap-sort";
import type { RoadmapItemView } from "../server/list-roadmap-items";
import { AreaPlanEditor } from "./RoadmapPlanEditor";

type BaseState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "loaded"; items: RoadmapItemView[]; canEdit: boolean };
type ArchivedState =
  | { phase: "off" }
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "loaded"; items: RoadmapItemView[] };

/** Team-level owner-selector dataset, fetched lazily once and shared by every area row. */
export type OwnersState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "loaded"; members: AssignableMemberOption[]; unavailableCount: number; truncated: boolean };

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
  const [base, setBase] = useState<BaseState>({ phase: "loading" });
  const [archived, setArchived] = useState<ArchivedState>({ phase: "off" });
  const [owners, setOwners] = useState<OwnersState>({ phase: "idle" });
  // Bumped whenever token/teamId change or the scope unmounts, so late responses are ignored.
  const epochRef = useRef(0);
  const archivedOnRef = useRef(false);
  const ownersPhaseRef = useRef<OwnersState["phase"]>("idle");

  useEffect(() => {
    let cancelled = false;
    fetchRoadmapItems(token, teamId).then((result) => {
      if (cancelled) return;
      setBase(
        result.status === "ok"
          ? { phase: "loaded", items: result.items, canEdit: result.canEdit }
          : { phase: "error" },
      );
    });
    return () => {
      cancelled = true;
      epochRef.current += 1;
      ownersPhaseRef.current = "idle";
    };
  }, [token, teamId]);

  function updateArchived(next: ArchivedState | ((current: ArchivedState) => ArchivedState)) {
    setArchived((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      archivedOnRef.current = resolved.phase !== "off";
      return resolved;
    });
  }

  // A response arriving after "Skjul arkiverte" is dropped: it only applies
  // while the state is still "loading".
  function showArchived() {
    updateArchived({ phase: "loading" });
    fetchRoadmapItems(token, teamId, { includeArchived: true }).then((result) => {
      updateArchived((current) => {
        if (current.phase !== "loading") return current;
        return result.status === "ok" ? { phase: "loaded", items: result.items } : { phase: "error" };
      });
    });
  }

  async function refresh(): Promise<boolean> {
    const epoch = epochRef.current;
    const includeArchived = archivedOnRef.current;
    const [baseResult, archivedResult] = await Promise.all([
      fetchRoadmapItems(token, teamId),
      includeArchived ? fetchRoadmapItems(token, teamId, { includeArchived: true }) : Promise.resolve(null),
    ]);
    if (epoch !== epochRef.current) return false;
    let success = true;
    if (baseResult.status === "ok") {
      setBase({ phase: "loaded", items: baseResult.items, canEdit: baseResult.canEdit });
    } else {
      success = false;
    }
    if (archivedResult !== null) {
      if (archivedResult.status === "ok") {
        updateArchived((current) =>
          current.phase === "off" ? current : { phase: "loaded", items: archivedResult.items },
        );
      } else {
        success = false;
      }
    }
    return success;
  }

  function loadOwners(force = false) {
    const phase = ownersPhaseRef.current;
    if (phase === "loading" || (phase === "loaded" && !force)) return;
    const epoch = epochRef.current;
    ownersPhaseRef.current = "loading";
    setOwners({ phase: "loading" });
    fetchAssignableMembers(token, teamId).then((result) => {
      if (epoch !== epochRef.current) return;
      if (result.status === "ok") {
        ownersPhaseRef.current = "loaded";
        setOwners({
          phase: "loaded",
          members: result.members,
          unavailableCount: result.unavailableCount,
          truncated: result.truncated,
        });
      } else {
        ownersPhaseRef.current = "error";
        setOwners({ phase: "error" });
      }
    });
  }

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
      if (base.phase === "error") {
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
            onClick={() => (archivedOn ? updateArchived({ phase: "off" }) : showArchived())}
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
