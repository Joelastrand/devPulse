"use client";

import { useId, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { CountStrip } from "../../../components/ui/CountStrip";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { Select } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { cx } from "../../../components/ui/class-names";
import { matchesSearchQuery } from "../../../components/ui/search-match";
import type { AdminSkillTreeEntry, SkillTreeNodeView } from "../client/skill-trees-gateway";
import { teamSkillTrackingCopy } from "../copy";
import { deriveSkillProgressPath, SkillProgressPath } from "./SkillProgressPath";

export type TeamSkillCatalogState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; trees: AdminSkillTreeEntry[] };

/**
 * One SkillTree's tracking state for this team (docs/archive/features/team-skill-tree/SPEC.md — TASK-006).
 * The parent seeds it from the team's persisted progress on load (`fetchTeamSkills`, the TASK-008 reload fix), so a fresh
 * render shows the stored stage. A failed read falls back to untracked. Later start, stage and stop calls update it only
 * after the server confirms.
 */
export type TeamSkillTrackingState =
  | { status: "untracked" }
  | { status: "tracked"; currentNodeId: string | null };

export type TeamSkillRowActionState =
  | { status: "idle" }
  | { status: "pending"; action: "start" | "setStage" | "stop" }
  | { status: "error"; message: string };

export interface TeamSkillTrackingSectionProps {
  catalogState: TeamSkillCatalogState;
  tracking: Record<string, TeamSkillTrackingState>;
  actions: Record<string, TeamSkillRowActionState>;
  teamDisabled: boolean;
  onStart: (treeId: string) => void;
  onSetStage: (treeId: string, nodeId: string) => void;
  onStop: (treeId: string) => void;
}

const copy = teamSkillTrackingCopy;

/**
 * `/admin/teams/[teamId]`'s "Kompetanseområder" tracking section (docs/archive/features/team-skill-tree/SPEC.md — TASK-006,
 * BR-27). The layout is a summary, then a compact list of tracked areas, then a compact, searchable list of untracked areas.
 * A tracked area shows its current stage and a progress bar. The full stage timeline and the stage and stop controls are
 * behind "Vis detaljer", so they are not shown by default.
 *
 * Progress is the position within the team's defined stage sequence. It is never presented as a competence percentage.
 * The final stage is the last node in that sequence. Stage changes save immediately on selection, as before. Start and
 * stop have no confirmation, as before. Presentation only: every mutation goes through the caller's callbacks. The
 * start picker is hidden when the team is disabled. Stage and stop controls are not gated here, matching the server.
 */
export function TeamSkillTrackingSection({
  catalogState,
  tracking,
  actions,
  teamDisabled,
  onStart,
  onSetStage,
  onStop,
}: TeamSkillTrackingSectionProps) {
  if (catalogState.status === "loading") {
    return <LoadingState label={copy.loading} />;
  }

  if (catalogState.status === "error") {
    return <Alert variant="error">{copy.error}</Alert>;
  }

  const { trees } = catalogState;

  if (trees.length === 0) {
    return <EmptyState>{copy.empty}</EmptyState>;
  }

  const trackedTrees = trees.filter((tree) => tracking[tree.treeId]?.status === "tracked");
  const untrackedTrees = trees.filter((tree) => tracking[tree.treeId]?.status !== "tracked");
  const atFinalCount = trackedTrees.filter(
    (tree) => describeProgress(tree.nodes, currentNodeIdOf(tracking, tree.treeId)).atFinal,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <CountStrip
        items={[
          { label: copy.summary.tracked, value: trackedTrees.length },
          { label: copy.summary.untracked, value: untrackedTrees.length },
          { label: copy.summary.atFinalStage, value: atFinalCount },
        ]}
      />

      <section aria-labelledby="team-skills-tracked-heading" className="flex flex-col gap-3">
        <h3 id="team-skills-tracked-heading" className="text-base font-semibold text-text-primary">
          {copy.tracked.sectionTitle} ({trackedTrees.length})
        </h3>
        {trackedTrees.length === 0 ? (
          <EmptyBox>{copy.tracked.empty}</EmptyBox>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-surface border border-border-subtle bg-surface shadow-card">
            {trackedTrees.map((tree) => (
              <TrackedSkillTreeRow
                key={tree.treeId}
                tree={tree}
                currentNodeId={currentNodeIdOf(tracking, tree.treeId)}
                action={actions[tree.treeId] ?? { status: "idle" as const }}
                onSetStage={(nodeId) => onSetStage(tree.treeId, nodeId)}
                onStop={() => onStop(tree.treeId)}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="team-skills-untracked-heading" className="flex flex-col gap-3">
        <div>
          <h3 id="team-skills-untracked-heading" className="text-base font-semibold text-text-primary">
            {copy.untracked.sectionTitle}
          </h3>
          {!teamDisabled && <p className="mt-1 text-sm text-text-secondary">{copy.untracked.description}</p>}
        </div>
        {teamDisabled ? (
          <Alert variant="info">{copy.untracked.disabledHint}</Alert>
        ) : untrackedTrees.length === 0 ? (
          <EmptyBox>{copy.untracked.empty}</EmptyBox>
        ) : (
          <UntrackedSkillTreeList
            trees={untrackedTrees}
            actions={actions}
            onStart={(treeId) => onStart(treeId)}
          />
        )}
      </section>
    </div>
  );
}

function currentNodeIdOf(tracking: Record<string, TeamSkillTrackingState>, treeId: string): string | null {
  const state = tracking[treeId];
  return state?.status === "tracked" ? state.currentNodeId : null;
}

/** Position, label and final-stage flag, derived from the defined stage order only. No competence measure is implied. */
function describeProgress(nodes: readonly SkillTreeNodeView[], currentNodeId: string | null) {
  const path = deriveSkillProgressPath(nodes, currentNodeId);
  const total = path.stages.length;
  const currentIndex = path.currentIndex;
  return {
    total,
    currentIndex,
    position: currentIndex === null ? null : currentIndex + 1,
    currentLabel: currentIndex === null ? null : path.stages[currentIndex].node.label,
    atFinal: currentIndex !== null && total > 0 && currentIndex === total - 1,
  };
}

function EmptyBox({ children }: { children: string }) {
  return (
    <p className="rounded-surface border border-border-subtle bg-surface px-4 py-4 text-sm text-text-secondary">{children}</p>
  );
}

/** Decorative stage bar. The text next to it carries the same information, so the bar is hidden from assistive technology. */
function StageBar({ total, filled }: { total: number; filled: number }) {
  if (total === 0) return null;
  return (
    <div aria-hidden="true" className="flex gap-1">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cx(
            "h-1.5 flex-1 rounded-full",
            index < filled ? "bg-primary" : "border border-border-subtle bg-surface-subtle",
          )}
        />
      ))}
    </div>
  );
}

interface TrackedSkillTreeRowProps {
  tree: AdminSkillTreeEntry;
  currentNodeId: string | null;
  action: TeamSkillRowActionState;
  onSetStage: (nodeId: string) => void;
  onStop: () => void;
}

function TrackedSkillTreeRow({ tree, currentNodeId, action, onSetStage, onStop }: TrackedSkillTreeRowProps) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = `skill-tree-details-${useId()}`;
  const progress = describeProgress(tree.nodes, currentNodeId);
  const isPending = action.status === "pending";
  const isStagePending = isPending && action.action === "setStage";
  const isStopPending = isPending && action.action === "stop";
  const sortedNodes = tree.nodes.slice().sort((a, b) => a.order - b.order);

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold text-text-primary">{tree.name}</p>
          {/* Only a genuinely unstarted area says so. An unknown stage ID shows no label rather than an invented one. */}
          {(progress.currentLabel ?? (currentNodeId === null ? copy.tracked.notStarted : null)) !== null && (
            <p className="mt-1 text-sm text-text-primary">
              {progress.currentLabel ?? copy.tracked.notStarted}
            </p>
          )}
          {progress.position !== null && (
            <p className="text-sm text-text-secondary">
              {copy.tracked.stageOf(progress.position, progress.total)}
              {progress.atFinal ? ` · ${copy.tracked.finalStage}` : ""}
            </p>
          )}
          <div className="mt-2 max-w-md">
            <StageBar total={progress.total} filled={progress.currentIndex === null ? 0 : progress.currentIndex + 1} />
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0 self-start sm:self-center"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${expanded ? copy.tracked.hideDetails : copy.tracked.showDetails} – ${tree.name}`}
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded ? copy.tracked.hideDetails : copy.tracked.showDetails}
        </Button>
      </div>

      {action.status === "error" && (
        <Alert variant="error" className="text-sm">
          {action.message}
        </Alert>
      )}

      {expanded && (
        <div id={detailsId} className="flex flex-col gap-4 border-t border-border-subtle pt-4">
          <SkillProgressPath name={tree.name} nodes={tree.nodes} currentNodeId={currentNodeId} />
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1 sm:max-w-xs">
              <Select
                id={`skill-tree-stage-${tree.treeId}`}
                label={copy.tracked.stageSelectLabel}
                aria-label={`${copy.tracked.stageSelectLabel} – ${tree.name}`}
                value={currentNodeId ?? ""}
                disabled={isPending}
                onChange={(event) => {
                  const nodeId = event.target.value;
                  if (nodeId) {
                    onSetStage(nodeId);
                  }
                }}
              >
                {currentNodeId === null && (
                  <option value="" disabled>
                    {copy.tracked.notStarted}
                  </option>
                )}
                {sortedNodes.map((node) => (
                  <option key={node.nodeId} value={node.nodeId}>
                    {node.label}
                  </option>
                ))}
              </Select>
            </div>
            {isStagePending && (
              <span role="status" className="text-sm text-text-secondary">
                {copy.tracked.stageSaving}
              </span>
            )}
            <Button
              variant="destructive"
              size="sm"
              disabled={isPending}
              pending={isStopPending}
              aria-label={`${isStopPending ? copy.tracked.stoppingButton : copy.tracked.stopButton} – ${tree.name}`}
              onClick={onStop}
            >
              {isStopPending ? copy.tracked.stoppingButton : copy.tracked.stopButton}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

interface UntrackedSkillTreeListProps {
  trees: readonly AdminSkillTreeEntry[];
  actions: Record<string, TeamSkillRowActionState>;
  onStart: (treeId: string) => void;
}

function UntrackedSkillTreeList({ trees, actions, onStart }: UntrackedSkillTreeListProps) {
  const [query, setQuery] = useState("");
  const matches = trees.filter((tree) => matchesSearchQuery(query, [tree.name]));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full min-w-0 sm:max-w-sm">
          <TextField
            id="skill-untracked-search"
            type="search"
            label={copy.untracked.searchLabel}
            value={query}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {query.trim() !== "" && (
          <Button type="button" variant="tertiary" size="sm" onClick={() => setQuery("")}>
            {copy.untracked.searchReset}
          </Button>
        )}
      </div>
      {matches.length === 0 ? (
        <EmptyBox>{copy.untracked.noSearchMatches}</EmptyBox>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-surface border border-border-subtle bg-surface shadow-card">
          {matches.map((tree) => (
            <UntrackedSkillTreeRow
              key={tree.treeId}
              tree={tree}
              action={actions[tree.treeId] ?? { status: "idle" as const }}
              onStart={() => onStart(tree.treeId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function UntrackedSkillTreeRow({
  tree,
  action,
  onStart,
}: {
  tree: AdminSkillTreeEntry;
  action: TeamSkillRowActionState;
  onStart: () => void;
}) {
  const isPending = action.status === "pending" && action.action === "start";

  return (
    <li className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="break-words text-text-primary">{tree.name}</p>
        {action.status === "error" && (
          <Alert variant="error" className="mt-1 text-sm">
            {action.message}
          </Alert>
        )}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0 self-start sm:self-center"
        pending={isPending}
        aria-label={`${isPending ? copy.untracked.startingButton : copy.untracked.startButton} – ${tree.name}`}
        onClick={onStart}
      >
        {isPending ? copy.untracked.startingButton : copy.untracked.startButton}
      </Button>
    </li>
  );
}
