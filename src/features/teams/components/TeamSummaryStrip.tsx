import type { SurveyResultSummary } from "../../results/client/team-results-gateway";

/**
 * Summary values for the team header (docs/features/visual-fidelity-and-ui-fixes
 * — TASK-010 / D-8). It renders the existing latest-survey values as plain text
 * inside the header band, without a status badge. It uses only the latest survey
 * already loaded for the Pulse section; no other summary item is read or
 * invented. Absent when there is no latest survey: never a zero.
 */
export const TEAM_SUMMARY_COPY = {
  latest: "Siste undersøkelse",
  status: "Status",
  published: "Resultat publisert",
  insufficient: "For få svar ennå",
} as const;

export function TeamSummaryStrip({ latest }: { latest: SurveyResultSummary | null }) {
  if (latest === null) {
    return null;
  }

  const published = latest.status === "published";
  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-body-secondary">
      <div className="flex items-center gap-2">
        <dt className="text-text-muted">{TEAM_SUMMARY_COPY.latest}</dt>
        <dd className="font-medium text-text-primary">{latest.title ?? latest.surveyId}</dd>
      </div>
      <div className="flex items-center gap-2">
        <dt className="text-text-muted">{TEAM_SUMMARY_COPY.status}</dt>
        <dd className={published ? "text-text-primary" : "text-text-muted"}>
          {published ? TEAM_SUMMARY_COPY.published : TEAM_SUMMARY_COPY.insufficient}
        </dd>
      </div>
    </dl>
  );
}
