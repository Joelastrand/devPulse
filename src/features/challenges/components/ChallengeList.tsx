import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { Alert } from "../../../components/ui/Alert";
import { formatSurveyDate } from "../../results/domain/format-survey-date";
import type { MemberChallengeView } from "../client/challenges-gateway";
import { challengesCopy } from "../copy";

export type ChallengeListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; challenges: MemberChallengeView[] };

/**
 * `/teams/[teamId]`'s read-only, member-facing challenge list
 * (docs/features/anonymous-challenges/SPEC.md — BR-9, BR-27). Renders
 * **exactly** what `listTeamChallengesForMember` (via
 * `fetchTeamChallenges`/the gateway's shape validation) returned — an
 * `archived` challenge can never reach this component at all, since
 * `MemberChallengeView["status"]` only ever types `"open" | "resolved"`, so
 * there is no code path here that could render one, filter one out, or
 * otherwise stand in for TASK-003's server-side guarantee
 * (`.claude/rules/security.md` — never rely on UI filtering for
 * authorization). Order is rendered exactly as received (already
 * newest-first, server-side) — never re-sorted here.
 */
export function ChallengeList({ state }: { state: ChallengeListState }) {
  if (state.status === "loading") {
    return <LoadingState label={challengesCopy.list.loading} />;
  }

  if (state.status === "error") {
    return <Alert variant="error">{challengesCopy.list.error}</Alert>;
  }

  if (state.challenges.length === 0) {
    return <EmptyState>{challengesCopy.list.empty}</EmptyState>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {state.challenges.map((challenge) => (
        <ChallengeCard key={challenge.challengeId} challenge={challenge} />
      ))}
    </ul>
  );
}

function ChallengeCard({ challenge }: { challenge: MemberChallengeView }) {
  return (
    <Card as="li" variant="bordered" padding="sm" className="flex flex-col gap-1">
      <p className="whitespace-pre-wrap break-words text-zinc-900 dark:text-zinc-50">{challenge.text}</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {challengesCopy.list.statusLabels[challenge.status]} ·{" "}
        {formatSurveyDate(new Date(challenge.submittedAt))}
      </p>
    </Card>
  );
}
