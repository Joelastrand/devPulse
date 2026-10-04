"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import type { AreaPlanning } from "../../roadmap/components/RoadmapPlanning";
import { reportTeamSkillProgress, type TeamSkillView } from "../client/skill-trees-gateway";
import { teamSkillSectionCopy } from "../copy";
import { SkillProgressPath } from "./SkillProgressPath";

export type TeamSkillSectionState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; skills: TeamSkillView[]; canReportProgress: boolean };

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
  /**
   * Optional read-only plan presentation (docs/features/team-skill-planning/
   * SPEC.md — BR-29/30): each row shows its plan summary, matched by
   * `treeId`, and the rows follow the planning order. Absent ⇒ unchanged.
   */
  planning?: AreaPlanning;
}

/**
 * `/teams/[teamId]`'s "Kompetanseområder" section (docs/features/
 * team-skill-tree/SPEC.md — TASK-007, BR-28 through BR-30; extended by
 * docs/features/skill-progress-self-report/SPEC.md — TASK-002, BR-10
 * through BR-12). Renders exactly what `fetchTeamSkills` (→
 * `getTeamSkillProgress`) returned — every tree the team is tracking, its
 * full ordered stage list and the current stage, rendered by the shared,
 * presentational `SkillProgressPath` (docs/features/gamified-skill-tree/
 * SPEC.md — BR-7), which owns ordering, the earlier/current/upcoming
 * derivation, the summary line and the "ikke startet" state for
 * `currentNodeId: null`. The path is never a control.
 *
 * Each already-tracked tree also gets a stage-setting control — but **only
 * when `state.canReportProgress` is true** (docs/features/
 * skill-progress-self-report/SPEC.md — "Permission-UI correction"): a
 * server-derived capability signal for whether *this* caller currently holds
 * genuine team membership on an active team, re-derived independently of
 * `authorizeTeamAccess`'s broader read-authorization result (an app-admin-
 * only viewer, or a member of a disabled team, gets `canReportProgress:
 * false`). When it is `false`, neither the stage `<select>` nor the "Lagre"
 * button is rendered at all for that viewer — not merely disabled — so
 * nothing on the page implies the control would become usable by waiting;
 * the read-only stage list above remains fully visible either way. This
 * component still invents no authorization logic of its own: it only ever
 * reflects the capability the server already computed, and
 * `reportTeamSkillProgress` remains the sole write-authorization boundary
 * regardless of this value. When the control is shown, a non-member/non-
 * admin's `forbidden` response and a disabled team's `team_disabled`
 * response (e.g. a team disabled after this page loaded) both still surface
 * as the same one generic authorization-failure message — never a distinct
 * "you're not a member"/"team is disabled" text. **No optimistic local
 * update**: a successful submission calls `onReported`, which re-fetches
 * through the existing `fetchTeamSkills` read path — this component never
 * locally mutates `state.skills`. A failed submission leaves the
 * previously-rendered current-stage marker untouched, since it is driven
 * entirely by the (unchanged) `state` prop (`.claude/rules/security.md`,
 * `.claude/rules/nextjs-react.md`).
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
export function TeamSkillSection({ idToken, teamId, state, onReported, planning }: TeamSkillSectionProps) {
  return (
    <Card as="section" variant="bordered" padding="md" aria-labelledby="team-skill-section-heading">
      <h2
        id="team-skill-section-heading"
        className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        {teamSkillSectionCopy.sectionTitle}
      </h2>
      <Link
        href={`/teams/${encodeURIComponent(teamId)}/roadmap`}
        className="mt-2 inline-block text-sm font-medium text-zinc-900 underline dark:text-zinc-50"
      >
        {teamSkillSectionCopy.seeRoadmap}
      </Link>

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
      {state.status === "loaded" && planning?.controls && (
        <div className="mt-4">{planning.controls}</div>
      )}
      {state.status === "loaded" && state.skills.length > 0 && (
        <ul className="mt-4 flex flex-col gap-4">
          {(planning ? planning.orderAreas(state.skills) : state.skills).map((skill) => (
            <TrackedSkillRow
              key={`${skill.treeId}-${skill.currentNodeId ?? "null"}`}
              skill={skill}
              idToken={idToken}
              teamId={teamId}
              canReportProgress={state.canReportProgress}
              onReported={onReported}
              planSlot={planning?.renderAreaPlan(skill)}
            />
          ))}
        </ul>
      )}
      {state.status === "loaded" && planning?.untracked && <div className="mt-6">{planning.untracked}</div>}
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
  canReportProgress,
  onReported,
  planSlot,
}: {
  planSlot?: ReactNode;
  skill: TeamSkillView;
  idToken: string;
  teamId: string;
  canReportProgress: boolean;
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
      <SkillProgressPath name={skill.name} nodes={skill.nodes} currentNodeId={skill.currentNodeId} />
      {planSlot}

      {canReportProgress && phase === "validation_error" && (
        <Alert variant="error" className="text-sm">
          {teamSkillSectionCopy.report.validationError}
        </Alert>
      )}
      {canReportProgress && phase === "authorization_error" && (
        <Alert variant="error" className="text-sm">
          {teamSkillSectionCopy.report.authorizationError}
        </Alert>
      )}
      {canReportProgress && phase === "infrastructure_error" && (
        <Alert variant="error" className="text-sm">
          {teamSkillSectionCopy.report.genericError}
        </Alert>
      )}

      {canReportProgress && (
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
      )}
    </Card>
  );
}
