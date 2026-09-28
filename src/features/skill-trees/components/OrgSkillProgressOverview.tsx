import { Alert } from "../../../components/ui/Alert";
import { Badge } from "../../../components/ui/Badge";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import type { OrgSkillProgressTreeView } from "../client/skill-trees-gateway";
import { orgSkillProgressOverviewCopy, teamSkillTrackingCopy } from "../copy";

export type OrgSkillProgressOverviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; trees: OrgSkillProgressTreeView[] };

export interface OrgSkillProgressOverviewProps {
  state: OrgSkillProgressOverviewState;
}

/**
 * The TASK-002 read-only cross-team overview section on `/admin/skills`
 * (docs/features/org-skill-progress-overview/SPEC.md — "UI/UX behavior").
 * Renders exactly the already-sorted `trees`/`teams` order the server DTO
 * provides (BR-11/BR-12) — this component never re-sorts, filters, or
 * mutates. No button, form, link, or other interactive/mutation control
 * exists anywhere in this section (Owner instruction 11), even though the
 * viewer (an app admin) already holds write permission elsewhere on the same
 * page.
 *
 * A `currentNodeId: null` entry renders the exact "Ikke startet" string
 * `teamSkillTrackingCopy.tracked.notStarted` already establishes for "not
 * started" (never blank, never a new duplicate string — SPEC "Per-tree
 * rendering"). A disabled team's entry is visibly labeled via text
 * (`orgSkillProgressOverviewCopy.disabledLabel`, "Deaktivert" — matching
 * `teams/copy.ts`'s `statusDisabled` convention), never color alone (BR-14).
 * A failure here renders in isolation (an `Alert`, nothing else) — the
 * caller composes this alongside the rest of `/admin/skills`, so a failure
 * here never hides or blocks the existing creation form/catalog.
 */
export function OrgSkillProgressOverview({ state }: OrgSkillProgressOverviewProps) {
  if (state.status === "loading") {
    return <LoadingState label={orgSkillProgressOverviewCopy.loading} />;
  }

  if (state.status === "error") {
    return <Alert variant="error">{orgSkillProgressOverviewCopy.error}</Alert>;
  }

  const { trees } = state;

  if (trees.length === 0) {
    return <EmptyState>{orgSkillProgressOverviewCopy.empty}</EmptyState>;
  }

  return (
    <section aria-labelledby="org-skill-progress-overview-heading" className="flex flex-col gap-4">
      <h2
        id="org-skill-progress-overview-heading"
        className="text-lg font-medium text-zinc-900 dark:text-zinc-50"
      >
        {orgSkillProgressOverviewCopy.sectionTitle}
      </h2>
      <ul className="flex flex-col gap-4">
        {trees.map((tree) => (
          <OrgSkillProgressTreeCard key={tree.treeId} tree={tree} />
        ))}
      </ul>
    </section>
  );
}

function OrgSkillProgressTreeCard({ tree }: { tree: OrgSkillProgressTreeView }) {
  const headingId = `org-skill-progress-tree-${tree.treeId}-heading`;

  return (
    <Card as="li" variant="bordered" padding="sm">
      <h3 id={headingId} className="break-words font-medium text-zinc-900 dark:text-zinc-50">
        {tree.name}
      </h3>
      <ul aria-labelledby={headingId} className="mt-2 flex flex-col gap-1">
        {tree.teams.map((team) => (
          <li key={team.teamId} className="break-words text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-medium text-zinc-900 dark:text-zinc-50">{team.teamName}</span>
            {team.teamStatus === "disabled" && (
              <Badge className="ml-2">{orgSkillProgressOverviewCopy.disabledLabel}</Badge>
            )}
            {" — "}
            {stageLabel(tree, team.currentNodeId)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function stageLabel(tree: OrgSkillProgressTreeView, currentNodeId: string | null): string {
  if (currentNodeId === null) {
    return teamSkillTrackingCopy.tracked.notStarted;
  }
  const node = tree.nodes.find((candidate) => candidate.nodeId === currentNodeId);
  return node?.label ?? currentNodeId;
}
