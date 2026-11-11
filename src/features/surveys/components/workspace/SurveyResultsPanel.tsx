"use client";

import { Alert } from "../../../../components/ui/Alert";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import type { SurveyResultsFetchResult } from "../../client/survey-builder-gateway";
import { builderCopy } from "../../builder-copy";
import type { QuestionStatistics } from "../../domain/question-statistics";

export interface SurveyResultsPanelProps {
  title: string;
  result: SurveyResultsFetchResult;
  onBack: () => void;
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function formatMean(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

/**
 * Per-question results for a survey (team-survey-builder TSB-008). Renders only
 * the data the server published. Counts and bars are always shown as text too,
 * never by colour alone. Free text appears only in a published question and
 * carries the re-identification note.
 */
export function SurveyResultsPanel({ title, result, onBack }: SurveyResultsPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-text-primary">{builderCopy.results.heading}</h2>
          <p className="text-help text-text-muted">{title}</p>
        </div>
        <Button type="button" variant="secondary" onClick={onBack}>
          {builderCopy.workspace.backToOverview}
        </Button>
      </div>
      <ResultsBody result={result} />
    </div>
  );
}

export function ResultsBody({ result }: { result: SurveyResultsFetchResult }) {
  switch (result.status) {
    case "not_closed":
      return <Alert variant="info">{builderCopy.results.notClosed}</Alert>;
    case "insufficient":
      return <Alert variant="info">{builderCopy.results.insufficient(result.survey.minimumResponses)}</Alert>;
    case "published":
      return (
        <div className="flex flex-col gap-4">
          <p className="text-label font-semibold text-text-primary">{builderCopy.results.responseCount(result.responseCount)}</p>
          {result.questions.map((question) => (
            <QuestionResultCard key={question.questionId} question={question} />
          ))}
        </div>
      );
    case "unauthenticated":
      return <Alert variant="info">{builderCopy.workspace.unauthenticated}</Alert>;
    case "forbidden":
      return <Alert variant="info">{builderCopy.workspace.forbidden}</Alert>;
    case "survey_not_found":
      return <Alert variant="info">{builderCopy.validation.survey_not_found}</Alert>;
    case "read_failed":
      return <Alert variant="error">{builderCopy.results.loadFailed}</Alert>;
  }
}

function QuestionResultCard({ question }: { question: QuestionStatistics }) {
  return (
    <Card as="section" variant="bordered" padding="md" aria-label={question.prompt}>
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-text-primary">{question.prompt}</h3>
        {question.status === "insufficient" ? (
          <p className="text-help text-text-muted">{builderCopy.results.insufficientQuestion}</p>
        ) : null}
        {question.status === "published" && question.type === "rating" ? <RatingResult question={question} /> : null}
        {question.status === "published" && (question.type === "single_choice" || question.type === "multiple_choice") ? (
          <OptionResult question={question} />
        ) : null}
        {question.status === "restricted" ? <Alert variant="info">{builderCopy.results.freeTextRestricted}</Alert> : null}
        {question.status === "published" && question.type === "free_text" ? (
          <FreeTextResult texts={question.texts} />
        ) : null}
      </div>
    </Card>
  );
}

function RatingResult({ question }: { question: Extract<QuestionStatistics, { type: "rating" }> }) {
  const total = question.answeredCount;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-label text-text-secondary">
        {builderCopy.results.mean}: <strong className="text-text-primary">{formatMean(question.mean)}</strong>
        {" · "}
        {builderCopy.results.answered(total)}
      </p>
      <p className="text-help text-text-muted">{builderCopy.results.distribution}</p>
      <ul className="flex flex-col gap-2">
        {(["1", "2", "3", "4", "5"] as const).map((value) => {
          const count = question.distribution[value];
          return (
            <BarRow key={value} label={value} count={count} percentValue={percent(count, total)} />
          );
        })}
      </ul>
    </div>
  );
}

function OptionResult({ question }: { question: Extract<QuestionStatistics, { type: "single_choice" | "multiple_choice" }> }) {
  const total = question.answeredCount;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-help text-text-muted">{builderCopy.results.answered(total)}</p>
      <ul className="flex flex-col gap-2">
        {question.options.map((option) => (
          <BarRow key={option.id} label={option.label} count={option.count} percentValue={percent(option.count, total)} />
        ))}
      </ul>
    </div>
  );
}

function FreeTextResult({ texts }: { texts: readonly string[] }) {
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="info">{builderCopy.results.freeTextNote}</Alert>
      {texts.length === 0 ? (
        <p className="text-help text-text-muted">{builderCopy.results.noText}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {texts.map((text, index) => (
            <li key={`${index}-${text.slice(0, 16)}`} className="rounded-control border border-border-subtle px-4 py-3 text-label text-text-primary">
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BarRow({ label, count, percentValue }: { label: string; count: number; percentValue: number }) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-label text-text-secondary">
        <span>{label}</span>
        <span className="font-medium text-text-primary">
          {count} ({percentValue} %)
        </span>
      </div>
      <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-field bg-surface-subtle">
        <div className="h-2 bg-primary" style={{ width: `${percentValue}%` }} />
      </div>
    </li>
  );
}
