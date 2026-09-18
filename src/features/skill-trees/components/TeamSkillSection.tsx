import { Alert } from "../../../components/ui/Alert";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import type { TeamSkillView } from "../client/skill-trees-gateway";
import { teamSkillSectionCopy } from "../copy";

export type TeamSkillSectionState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; skills: TeamSkillView[] };

export interface TeamSkillSectionProps {
  state: TeamSkillSectionState;
}

/**
 * `/teams/[teamId]`'s read-only "Kompetanseområder" section
 * (docs/features/team-skill-tree/SPEC.md — TASK-007, BR-28 through BR-30).
 * Renders exactly what `fetchTeamSkills` (→ `getTeamSkillProgress`) returned
 * — every tree the team is tracking, its full ordered stage list as a
 * semantic `<ol>`, and the current stage marked with both `aria-current="step"`
 * and visible text (never color alone, BR-29). A tree with
 * `currentNodeId: null` renders a distinct "ikke startet" state rather than
 * silently showing no marker at all.
 *
 * Purely presentational and strictly read-only — no start/set-stage/stop
 * control of any kind exists here (unlike `TeamSkillTrackingSection`, the
 * admin-only counterpart). This component owns no gateway call, no
 * Firestore access, and no authorization decision — `getTeamSkillProgress`
 * already guarantees a non-member/non-admin never receives this data
 * (`.claude/rules/security.md`). `name`/node `label` are untrusted
 * admin-authored display strings, rendered as ordinary React text — never
 * `dangerouslySetInnerHTML` or any HTML-parsing path.
 */
export function TeamSkillSection({ state }: TeamSkillSectionProps) {
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
            <TrackedSkillRow key={skill.treeId} skill={skill} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function sortedNodes(skill: TeamSkillView) {
  return skill.nodes.slice().sort((a, b) => a.order - b.order);
}

function TrackedSkillRow({ skill }: { skill: TeamSkillView }) {
  return (
    <Card as="li" variant="bordered" padding="sm" className="flex flex-col gap-2">
      <p className="break-words font-medium text-zinc-900 dark:text-zinc-50">{skill.name}</p>
      {skill.currentNodeId === null && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{teamSkillSectionCopy.notStarted}</p>
      )}
      <ol className="ml-5 list-decimal text-sm text-zinc-700 dark:text-zinc-300">
        {sortedNodes(skill).map((node) => {
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
    </Card>
  );
}
