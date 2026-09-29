"use client";

import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { Select } from "../../../components/ui/Select";
import type { AdminSkillTreeEntry } from "../client/skill-trees-gateway";
import { teamSkillTrackingCopy } from "../copy";
import { SkillProgressPath } from "./SkillProgressPath";

export type TeamSkillCatalogState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; trees: AdminSkillTreeEntry[] };

/**
 * One SkillTree's tracking state for this team, as known to this session
 * (docs/features/team-skill-tree/SPEC.md — TASK-006). TASK-006 owns no read
 * endpoint of its own (SPEC's finalized route table has no `GET` under
 * `/api/admin/teams/[teamId]/skills`; the only `GET` for a team's tracking
 * state is TASK-007's team-facing `/api/teams/[teamId]/skills`, which this
 * task must not build as a shortcut) — so this state is derived entirely
 * from this component's own successful start/update/stop calls, not fetched.
 * A page reload starts every catalog tree "untracked" again; that is the
 * deliberately narrow v1 shape TASKS.md's own verification list describes
 * ("start-tracking picker... correctly recomputed after a successful
 * start"), not a bug.
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

/**
 * `/admin/teams/[teamId]`'s "Kompetanseområder" tracking section
 * (docs/features/team-skill-tree/SPEC.md — TASK-006, BR-27). Renders the
 * TASK-005 catalog (`catalogState`, reused unchanged) split into two groups
 * by this session's own `tracking` state: trees not yet tracked by this
 * team offer a "start tracking" action; already-tracked trees show their
 * full ordered stage list with the current stage marked, rendered by the
 * shared presentational `SkillProgressPath` (docs/features/gamified-skill-tree/
 * SPEC.md — BR-8; `aria-current="step"` plus visible text, never color alone
 * — BR-29; never a control), and controls to change the stage (forward or
 * backward, BR-13) or stop tracking.
 *
 * **The start-tracking picker is hidden when `teamDisabled` is true**
 * (`startTeamSkillTracking` genuinely rejects a disabled team server-side —
 * this is presentation only, never the authorization boundary itself). The
 * set-stage/stop-tracking controls for already-tracked trees are rendered
 * unconditionally regardless of `teamDisabled`, matching the server
 * contract exactly (SPEC — Owner decision 5, BR-16): this component never
 * adds a team-status gate of its own to either.
 *
 * Purely presentational — every mutation is delegated to the caller's
 * `onStart`/`onSetStage`/`onStop` callbacks; this component owns no gateway
 * call, no Firestore access, and no authorization decision
 * (`.claude/rules/security.md`).
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
    return <LoadingState label={teamSkillTrackingCopy.loading} />;
  }

  if (catalogState.status === "error") {
    return <Alert variant="error">{teamSkillTrackingCopy.error}</Alert>;
  }

  const { trees } = catalogState;

  if (trees.length === 0) {
    return <EmptyState>{teamSkillTrackingCopy.empty}</EmptyState>;
  }

  const trackedTrees = trees.filter((tree) => tracking[tree.treeId]?.status === "tracked");
  const untrackedTrees = trees.filter((tree) => tracking[tree.treeId]?.status !== "tracked");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {teamSkillTrackingCopy.tracked.sectionTitle}
        </h3>
        {trackedTrees.length === 0 ? (
          <EmptyState>{teamSkillTrackingCopy.tracked.empty}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {trackedTrees.map((tree) => {
              const state = tracking[tree.treeId];
              const currentNodeId = state?.status === "tracked" ? state.currentNodeId : null;
              return (
                <TrackedSkillTreeRow
                  key={tree.treeId}
                  tree={tree}
                  currentNodeId={currentNodeId}
                  action={actions[tree.treeId] ?? { status: "idle" as const }}
                  onSetStage={(nodeId) => onSetStage(tree.treeId, nodeId)}
                  onStop={() => onStop(tree.treeId)}
                />
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {teamSkillTrackingCopy.untracked.sectionTitle}
        </h3>
        {teamDisabled ? (
          <Alert variant="info">{teamSkillTrackingCopy.untracked.disabledHint}</Alert>
        ) : untrackedTrees.length === 0 ? (
          <EmptyState>{teamSkillTrackingCopy.untracked.empty}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {untrackedTrees.map((tree) => (
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
    </div>
  );
}

function sortedNodes(tree: AdminSkillTreeEntry) {
  return tree.nodes.slice().sort((a, b) => a.order - b.order);
}

interface TrackedSkillTreeRowProps {
  tree: AdminSkillTreeEntry;
  currentNodeId: string | null;
  action: TeamSkillRowActionState;
  onSetStage: (nodeId: string) => void;
  onStop: () => void;
}

function TrackedSkillTreeRow({ tree, currentNodeId, action, onSetStage, onStop }: TrackedSkillTreeRowProps) {
  const isPending = action.status === "pending";
  const isStagePending = isPending && action.action === "setStage";
  const isStopPending = isPending && action.action === "stop";

  return (
    <Card as="li" variant="bordered" padding="sm" className="flex flex-col gap-2">
      <p className="font-medium text-zinc-900 dark:text-zinc-50">{tree.name}</p>
      <SkillProgressPath name={tree.name} nodes={tree.nodes} currentNodeId={currentNodeId} />

      {action.status === "error" && (
        <Alert variant="error" className="text-sm">
          {action.message}
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          id={`skill-tree-stage-${tree.treeId}`}
          label={teamSkillTrackingCopy.tracked.stageSelectLabel}
          aria-label={`${teamSkillTrackingCopy.tracked.stageSelectLabel} – ${tree.name}`}
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
              {teamSkillTrackingCopy.tracked.notStarted}
            </option>
          )}
          {sortedNodes(tree).map((node) => (
            <option key={node.nodeId} value={node.nodeId}>
              {node.label}
            </option>
          ))}
        </Select>
        {isStagePending && (
          <span role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
            …
          </span>
        )}
        <Button
          variant="destructive"
          size="sm"
          disabled={isPending}
          pending={isStopPending}
          aria-label={`${isStopPending ? teamSkillTrackingCopy.tracked.stoppingButton : teamSkillTrackingCopy.tracked.stopButton} – ${tree.name}`}
          onClick={onStop}
        >
          {isStopPending ? teamSkillTrackingCopy.tracked.stoppingButton : teamSkillTrackingCopy.tracked.stopButton}
        </Button>
      </div>
    </Card>
  );
}

interface UntrackedSkillTreeRowProps {
  tree: AdminSkillTreeEntry;
  action: TeamSkillRowActionState;
  onStart: () => void;
}

function UntrackedSkillTreeRow({ tree, action, onStart }: UntrackedSkillTreeRowProps) {
  const isPending = action.status === "pending" && action.action === "start";

  return (
    <Card as="li" variant="bordered" padding="sm" className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="break-words font-medium text-zinc-900 dark:text-zinc-50">{tree.name}</p>
        {action.status === "error" && (
          <Alert variant="error" className="mt-1 text-sm">
            {action.message}
          </Alert>
        )}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0"
        pending={isPending}
        aria-label={`${isPending ? teamSkillTrackingCopy.untracked.startingButton : teamSkillTrackingCopy.untracked.startButton} – ${tree.name}`}
        onClick={onStart}
      >
        {isPending ? teamSkillTrackingCopy.untracked.startingButton : teamSkillTrackingCopy.untracked.startButton}
      </Button>
    </Card>
  );
}
