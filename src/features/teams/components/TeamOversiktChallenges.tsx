import type { ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Card } from "../../../components/ui/Card";
import { formatSurveyDate } from "../../results/domain/format-survey-date";
import type { MemberChallengeView } from "../../challenges/client/challenges-gateway";
import { challengesCopy } from "../../challenges/copy";

/** How many open challenges the overview lists. The full history is not shown here (docs/features/team-experience-redesign). */
export const OVERSIKT_CHALLENGE_LIMIT = 3;

export type OversiktChallengesState =
  | { status: "loaded"; challenges: readonly MemberChallengeView[]; canSubmit: boolean }
  | { status: "unavailable" };

/**
 * Compact "Åpne utfordringer" card for the overview (reference 18). Shows only open challenges, in the order the server
 * returned them. The submission entry point is passed in as `action` (rendered beside the title) so the card stays
 * presentational; the form itself lives in a dialog (`ChallengeSubmissionDialog`), never inline.
 */
export function TeamOversiktChallenges({ state, action }: { state: OversiktChallengesState; action?: ReactNode }) {
  return (
    <Card as="section" variant="bordered" padding="md" aria-labelledby="team-oversikt-challenges" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="team-oversikt-challenges" className="text-section-title font-semibold text-text-primary">
          {OVERSIKT_CHALLENGES_COPY.heading}
        </h2>
        {action}
      </div>
      {state.status === "unavailable" ? (
        <Alert variant="error">{challengesCopy.list.error}</Alert>
      ) : (
        <OpenChallengeRows challenges={state.challenges.filter((challenge) => challenge.status === "open").slice(0, OVERSIKT_CHALLENGE_LIMIT)} />
      )}
    </Card>
  );
}

const OVERSIKT_CHALLENGES_COPY = {
  heading: "Åpne utfordringer",
  empty: "Ingen åpne utfordringer.",
} as const;

function OpenChallengeRows({ challenges }: { challenges: readonly MemberChallengeView[] }) {
  if (challenges.length === 0) {
    return <p className="text-sm text-text-secondary">{OVERSIKT_CHALLENGES_COPY.empty}</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-border-subtle" aria-label={OVERSIKT_CHALLENGES_COPY.heading}>
      {challenges.map((challenge) => (
        <li key={challenge.challengeId} className="flex flex-col gap-1 py-3">
          <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{challenge.text}</p>
          <p className="text-xs text-text-secondary">{formatSurveyDate(new Date(challenge.submittedAt))}</p>
        </li>
      ))}
    </ul>
  );
}
