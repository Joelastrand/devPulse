"use client";

import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { reportTeamSkillProgress, type TeamSkillView } from "../client/skill-trees-gateway";
import { teamSkillSectionCopy } from "../copy";

export type TeamSkillSectionState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; skills: TeamSkillView[] };

export interface TeamSkillSectionProps {
  idToken: string;
  teamId: string;
  state: TeamSkillSectionState;
  /**
   * Invoked after a successful self-report so the caller can refresh the
   * tracked-skill list through the existing, unchanged `getTeamSkillProgress`
   * read path (`fetchTeamSkills`) — this component never locally mutates
   * `state.skills` or fabricates a `TeamSkillView` of its own (docs/features/
   * skill-progress-self-report/SPEC.md — TASK-002, "No optimistic local
   * update").
   */
  onReported: () => void;
}

/**
 * `/teams/[teamId]`'s "Kompetanseområder" section (docs/features/
 * team-skill-tree/SPEC.md — TASK-007, BR-28 through BR-30; extended by
 * docs/features/skill-progress-self-report/SPEC.md — TASK-002, BR-10
 * through BR-12). Renders exactly what `fetchTeamSkills` (→
 * `getTeamSkillProgress`) returned — every tree the team is tracking, its
 * full ordered stage list as a semantic `<ol>`, and the current stage
 * marked with both `aria-current="step"` and visible text (never color
 * alone, unchanged from Phase 7). A tree with `currentNodeId: null` renders
 * a distinct "ikke startet" state rather than silently showing no marker at
 * all.
 *
 * Each already-tracked tree also gets a stage-setting control, rendered
 * unconditionally for any authorized viewer of the page (member or admin,
 * per `authorizeTeamAccess`) — this component invents no client-side
 * membership/admin distinction of its own (BR-10). A non-member/non-admin's
 * `forbidden` response and a disabled team's `team_disabled` response both
 * surface as the same one generic authorization-failure message — never a
 * distinct "you're not a member"/"team is disabled" text. **No optimistic
 * local update**: a successful submission calls `onReported`, which
 * re-fetches through the existing `fetchTeamSkills` read path — this
 * component never locally mutates `state.skills`. A failed submission
 * leaves the previously-rendered current-stage marker untouched, since it
 * is driven entirely by the (unchanged) `state` prop
 * (`.claude/rules/security.md`, `.claude/rules/nextjs-react.md`).
 *
 * Each row is keyed by `treeId` **and** `currentNodeId` so that a
 * post-report refresh (a new `currentNodeId` arriving via `state`) remounts
 * the row — resetting its local stage-selector back to the freshly
 * persisted value by construction, rather than via a `useEffect` sync
 * (`.claude/rules/nextjs-react.md` — "avoid `useEffect` when work can
 * happen ... during rendering").
 *
 * `name`/node `label` are untrusted admin-authored display strings,
 * rendered as ordinary React text — never `dangerouslySetInnerHTML` or any
 * HTML-parsing path.
 */
export function TeamSkillSection({ idToken, teamId, state, onReported }: TeamSkillSectionProps) {
  return (
    <Card as="section" variant="bordered" padding="md" aria-labelledby="team-skill-section-heading">
      <h2
        id="team-skill-section-heading"
        className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        {teamSkillSectionCopy.sectionTitle}
      </h2>

      {state.status === "loading" && (
        <LoadingState label={teamSkillSectionCopy.loading} className="mt-4" />
      )}
      {state.status === "error" && (
        <Alert variant="error" className="mt-4">
          {teamSkillSectionCopy.error}
        </Alert>
      )}
      {state.status === "loaded" && state.skills.length === 0 && (
        <EmptyState className="mt-4">{teamSkillSectionCopy.empty}</EmptyState>
      )}
      {state.status === "loaded" && state.skills.length > 0 && (
        <ul className="mt-4 flex flex-col gap-4">
          {state.skills.map((skill) => (
            <TrackedSkillRow
              key={`${skill.treeId}-${skill.currentNodeId ?? "null"}`}
              skill={skill}
              idToken={idToken}
              teamId={teamId}
              onReported={onReported}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function sortedNodes(skill: TeamSkillView) {
  return skill.nodes.slice().sort((a, b) => a.order - b.order);
}

type ReportPhase = "idle" | "pending" | "validation_error" | "authorization_error" | "infrastructure_error";

function TrackedSkillRow({
  skill,
  idToken,
  teamId,
  onReported,
}: {
  skill: TeamSkillView;
  idToken: string;
  teamId: string;
  onReported: () => void;
}) {
  const nodes = sortedNodes(skill);
  const [selectedNodeId, setSelectedNodeId] = useState(skill.currentNodeId ?? nodes[0]?.nodeId ?? "");
  const [phase, setPhase] = useState<ReportPhase>("idle");
  const isPending = phase === "pending";

  async function handleReport() {
    if (!selectedNodeId) {
      return;
    }

    setPhase("pending");
    const result = await reportTeamSkillProgress(idToken, teamId, skill.treeId, selectedNodeId);

    if (result.ok) {
      setPhase("idle");
      onReported();
      return;
    }

    if (result.error === "invalid_input") {
      setPhase("validation_error");
      return;
    }

    if (result.error === "forbidden" || result.error === "team_disabled" || result.error === "unauthenticated") {
      setPhase("authorization_error");
      return;
    }

    setPhase("infrastructure_error");
  }

  return (
    <Card as="li" variant="bordered" padding="sm" className="flex flex-col gap-2">
      <p className="break-words font-medium text-zinc-900 dark:text-zinc-50">{skill.name}</p>
      {skill.currentNodeId === null && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{teamSkillSectionCopy.notStarted}</p>
      )}
      <ol className="ml-5 list-decimal text-sm text-zinc-700 dark:text-zinc-300">
        {nodes.map((node) => {
          const isCurrent = node.nodeId === skill.currentNodeId;
          return (
            <li key={node.nodeId} aria-current={isCurrent ? "step" : undefined}>
              {node.label}
              {isCurrent && (
                <span className="ml-2 font-medium text-zinc-900 dark:text-zinc-50">
                  ({teamSkillSectionCopy.currentStageLabel})
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {phase === "validation_error" && (
        <Alert variant="error" className="text-sm">
          {teamSkillSectionCopy.report.validationError}
        </Alert>
      )}
      {phase === "authorization_error" && (
        <Alert variant="error" className="text-sm">
          {teamSkillSectionCopy.report.authorizationError}
        </Alert>
      )}
      {phase === "infrastructure_error" && (
        <Alert variant="error" className="text-sm">
          {teamSkillSectionCopy.report.genericError}
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={`skill-tree-report-${skill.treeId}`}
          className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
        >
          {teamSkillSectionCopy.report.stageSelectLabel}
        </label>
        <select
          id={`skill-tree-report-${skill.treeId}`}
          aria-label={`${teamSkillSectionCopy.report.stageSelectLabel} – ${skill.name}`}
          value={selectedNodeId}
          disabled={isPending}
          onChange={(event) => setSelectedNodeId(event.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {nodes.map((node) => (
            <option key={node.nodeId} value={node.nodeId}>
              {node.label}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          size="sm"
          disabled={isPending}
          pending={isPending}
          aria-label={`${isPending ? teamSkillSectionCopy.report.submittingButton : teamSkillSectionCopy.report.submitButton} – ${skill.name}`}
          onClick={handleReport}
        >
          {isPending ? teamSkillSectionCopy.report.submittingButton : teamSkillSectionCopy.report.submitButton}
        </Button>
      </div>
    </Card>
  );
}
