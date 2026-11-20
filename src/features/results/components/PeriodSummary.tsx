import { Alert } from "../../../components/ui/Alert";
import { EmptyState } from "../../../components/ui/EmptyState";
import type { SurveyResultSummary } from "../client/team-results-gateway";
import { resultsCopy } from "../copy";

/**
 * The latest closed survey's context: its title and how many responses it has. The three dimension values are not repeated
 * here; they are shown once, in the results summary strip directly below. A survey below its privacy threshold shows only
 * the threshold message, never a value or a count (`resultsCopy.latestSurvey.insufficient`). `result` is `null` only when the
 * team has no closed surveys yet (BR-27: a scheduled or open survey is never eligible here).
 */
export function PeriodSummary({ result }: { result: SurveyResultSummary | null }) {
  return (
    <section aria-labelledby="latest-survey-heading" className="flex flex-col gap-2">
      <h2 id="latest-survey-heading" className="text-lg font-semibold text-text-primary">
        {resultsCopy.latestSurvey.heading}
      </h2>
      {result === null ? (
        <EmptyState>{resultsCopy.latestSurvey.empty}</EmptyState>
      ) : result.status === "published" ? (
        <div className="flex flex-col gap-1 text-sm text-text-secondary">
          {result.title ? <p className="break-words font-medium text-text-primary">{result.title}</p> : null}
          <p>{resultsCopy.latestSurvey.responses(result.count)}</p>
        </div>
      ) : (
        <Alert variant="info">{resultsCopy.latestSurvey.insufficient(result.minimumResponses)}</Alert>
      )}
    </section>
  );
}
