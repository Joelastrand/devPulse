import { StatusBadge } from "../../../components/ui/StatusBadge";
import type { SurveyResultSummary } from "../../results/client/team-results-gateway";

/**
 * Summary strip at the top of the team overview (docs/features/product-
 * experience/SPEC.md — Team experience structure). It uses only the latest
 * survey already loaded for the Pulse section. The change since the previous
 * survey and the other summary items are not in this response, so they are not
 * shown here. Absent when there is no latest survey: never a zero.
 */
export const TEAM_SUMMARY_COPY = {
  latest: "Siste undersøkelse",
  published: "Resultat publisert",
  insufficient: "For få svar ennå",
} as const;

export function TeamSummaryStrip({ latest }: { latest: SurveyResultSummary | null }) {
  if (latest === null) {
    return null;
  }

  const published = latest.status === "published";
  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-surface border border-border-subtle bg-surface px-4 py-3 text-body-secondary shadow-card">
      <div className="flex items-center gap-2">
        <dt className="text-text-muted">{TEAM_SUMMARY_COPY.latest}</dt>
        <dd className="font-medium text-text-primary">{latest.title ?? latest.surveyId}</dd>
      </div>
      <div>
        <StatusBadge tone={published ? "success" : "neutral"}>
          {published ? TEAM_SUMMARY_COPY.published : TEAM_SUMMARY_COPY.insufficient}
        </StatusBadge>
      </div>
    </dl>
  );
}
