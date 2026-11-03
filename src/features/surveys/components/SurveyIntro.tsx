"use client";

import { Button } from "../../../components/ui/Button";
import { PageHeader } from "../../../components/ui/PageHeader";
import { surveysCopy } from "../copy";

/**
 * Intro screen for a survey the visitor can answer (docs/features/product-
 * experience/SPEC.md — BR-S1, BR-S1a). The locked notice stays visible. The
 * five-point disclosure is collapsed by default and uses native
 * `<details>`. Pressing Start is the only way into the form. Nothing here is
 * stored.
 */
export function SurveyIntro({
  title,
  teamName,
  onStart,
}: {
  title: string;
  teamName?: string;
  onStart: () => void;
}) {
  const intro = surveysCopy.intro;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={teamName} />
      <p className="text-survey-body text-text-secondary">
        <strong className="font-semibold text-text-primary">{intro.noticeLead}</strong>{" "}
        {intro.noticeRest}
      </p>
      <details className="rounded-control border border-border-subtle px-4 py-3">
        <summary className="cursor-pointer text-label font-medium text-text-primary">
          {intro.disclosureTitle}
        </summary>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-body-secondary text-text-secondary">
          {intro.disclosurePoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ol>
      </details>
      <div>
        <Button onClick={onStart}>{intro.start}</Button>
      </div>
    </div>
  );
}
