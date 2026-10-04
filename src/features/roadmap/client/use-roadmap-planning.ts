"use client";

import { useEffect, useRef, useState } from "react";
import type { RoadmapItemView } from "../server/list-roadmap-items";
import { fetchAssignableMembers, fetchRoadmapItems, type AssignableMemberOption } from "./roadmap-gateway";

/**
 * How the roadmap is read.
 * - `lazy-archived` (Feature A): base read on mount; the archived-inclusive read
 *   happens only when `showArchived()` is called, and `refresh()` refetches the
 *   base read plus the archived read while it is on.
 * - `archived-inclusive` (Feature B): one `?archived=true` read on mount and one
 *   per `refresh()`. `roadmap.items` is the complete canonical set, archived
 *   plans included; archived visibility is the caller's concern.
 */
export type RoadmapPlanningMode = "lazy-archived" | "archived-inclusive";

export type RoadmapReadState =
  | { phase: "loading" }
  | { phase: "error" }
  /** `archived-inclusive` mode only: the initial read or a refresh was authoritatively denied (`forbidden`/unknown team). */
  | { phase: "forbidden" }
  | { phase: "loaded"; items: RoadmapItemView[]; canEdit: boolean; truncated: boolean };

/** Lazy archived read (`lazy-archived` mode only); always `off` in `archived-inclusive` mode. */
export type ArchivedState =
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

export interface RoadmapPlanningController {
  roadmap: RoadmapReadState;
  /** True when `roadmap.items` already contains archived plans (`archived-inclusive` mode). */
  includesArchived: boolean;
  archived: ArchivedState;
  /** `lazy-archived` only: starts the archived read. No-op in `archived-inclusive` mode. */
  showArchived(): void;
  /** `lazy-archived` only: hides archived plans again. No-op in `archived-inclusive` mode. */
  hideArchived(): void;
  /** Refetches the canonical read(s). Resolves `true` only when every needed refetch succeeded. */
  refresh(): Promise<boolean>;
  owners: OwnersState;
  /** Loads the owner dataset once; `force` reloads it (e.g. after `invalid_owner`). */
  loadOwners(force?: boolean): void;
}

/**
 * Roadmap read, refresh and owner-dataset state shared by the planning UIs.
 * Writes never update this state directly: after a successful mutation the
 * caller invokes `refresh()`. A failed refresh keeps the previous state and
 * reports `false`. Results of a request started under an earlier
 * `token`/`teamId` are dropped (epoch check). The owner dataset is fetched at
 * most once per scope. Remount with a new `key` when the auth identity changes.
 */
export function useRoadmapPlanning({
  token,
  teamId,
  mode,
}: {
  token: string;
  teamId: string;
  mode: RoadmapPlanningMode;
}): RoadmapPlanningController {
  const inclusive = mode === "archived-inclusive";
  const [roadmap, setRoadmap] = useState<RoadmapReadState>({ phase: "loading" });
  const [archived, setArchived] = useState<ArchivedState>({ phase: "off" });
  const [owners, setOwners] = useState<OwnersState>({ phase: "idle" });
  // Bumped whenever token/teamId change or the scope unmounts, so late responses are ignored.
  const epochRef = useRef(0);
  const archivedOnRef = useRef(false);
  const ownersPhaseRef = useRef<OwnersState["phase"]>("idle");
  // `archived-inclusive` refreshes: only the most recently started one may apply its result.
  const latestRefreshRef = useRef<{ id: number; promise: Promise<boolean> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = inclusive
      ? fetchRoadmapItems(token, teamId, { includeArchived: true })
      : fetchRoadmapItems(token, teamId);
    read.then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        setRoadmap({ phase: "loaded", items: result.items, canEdit: result.canEdit, truncated: result.truncated });
      } else {
        setRoadmap({ phase: inclusive && result.status === "forbidden" ? "forbidden" : "error" });
      }
    });
    return () => {
      cancelled = true;
      epochRef.current += 1;
      ownersPhaseRef.current = "idle";
    };
  }, [token, teamId, inclusive]);

  function updateArchived(next: ArchivedState | ((current: ArchivedState) => ArchivedState)) {
    setArchived((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      archivedOnRef.current = resolved.phase !== "off";
      return resolved;
    });
  }

  // A response arriving after `hideArchived()` is dropped: it only applies
  // while the state is still "loading".
  function showArchived() {
    if (inclusive) return;
    updateArchived({ phase: "loading" });
    fetchRoadmapItems(token, teamId, { includeArchived: true }).then((result) => {
      updateArchived((current) => {
        if (current.phase !== "loading") return current;
        return result.status === "ok" ? { phase: "loaded", items: result.items } : { phase: "error" };
      });
    });
  }

  function hideArchived() {
    if (inclusive) return;
    updateArchived({ phase: "off" });
  }

  async function refresh(): Promise<boolean> {
    const epoch = epochRef.current;
    if (inclusive) return refreshInclusive(epoch);
    const includeArchived = archivedOnRef.current;
    const [baseResult, archivedResult] = await Promise.all([
      fetchRoadmapItems(token, teamId),
      includeArchived ? fetchRoadmapItems(token, teamId, { includeArchived: true }) : Promise.resolve(null),
    ]);
    if (epoch !== epochRef.current) return false;
    let success = true;
    if (baseResult.status === "ok") {
      setRoadmap({
        phase: "loaded",
        items: baseResult.items,
        canEdit: baseResult.canEdit,
        truncated: baseResult.truncated,
      });
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

  /**
   * Overlapping refreshes (two successful writes in flight) are last-started-wins: a superseded
   * response never overwrites a newer one, and its caller reports the outcome of the newer refresh.
   */
  function refreshInclusive(epoch: number): Promise<boolean> {
    const id = (latestRefreshRef.current?.id ?? 0) + 1;
    const promise = (async () => {
      const result = await fetchRoadmapItems(token, teamId, { includeArchived: true });
      if (epoch !== epochRef.current) return false;
      const latest = latestRefreshRef.current;
      if (latest && latest.id !== id) return latest.promise;
      if (result.status === "forbidden") {
        // Authoritative permission loss must not leave stale roadmap data (or a generic error) visible.
        setRoadmap({ phase: "forbidden" });
        return false;
      }
      if (result.status !== "ok") return false;
      setRoadmap({ phase: "loaded", items: result.items, canEdit: result.canEdit, truncated: result.truncated });
      return true;
    })();
    latestRefreshRef.current = { id, promise };
    return promise;
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

  return { roadmap, includesArchived: inclusive, archived, showArchived, hideArchived, refresh, owners, loadOwners };
}
