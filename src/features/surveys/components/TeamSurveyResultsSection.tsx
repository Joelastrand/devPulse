"use client";

import { useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  fetchSurveyResults,
  fetchTeamResultsSurveys,
  type SurveyResultsFetchResult,
  type TeamResultsSurveyItem,
} from "../client/survey-builder-gateway";
import { builderCopy } from "../builder-copy";
import { ResultsBody } from "./workspace/SurveyResultsPanel";

type ListState =
  | { status: "loading" }
  | { status: "ready"; surveys: TeamResultsSurveyItem[] }
  | { status: "error"; reason: "forbidden" | "unauthenticated" | "read_failed" };

/**
 * "Spørreundersøkelser" block on `/teams/[teamId]/results` (team-survey-builder
 * TSB-008). Lists the team's closed surveys with their own question sets and
 * loads each one's per-question results on demand. Everything shown is what the
 * server published. Suppression, free-text restriction and authorization all
 * happen in the results endpoints. The legacy Flow/Stress/Fun trend above is
 * unchanged.
 */
export function TeamSurveyResultsSection({ teamId }: { teamId: string }) {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SurveyResultsFetchResult>>({});
  const tokenRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  useAuthGatedResource(
    (token) => {
      const generation = ++generationRef.current;
      tokenRef.current = token;
      setOpenId(null);
      setResults({});
      if (token === null) {
        setList({ status: "error", reason: "unauthenticated" });
        return;
      }
      setList({ status: "loading" });
      void fetchTeamResultsSurveys(token, teamId).then((result) => {
        if (generation !== generationRef.current) {
          return;
        }
        if (result.status === "ok") {
          setList({ status: "ready", surveys: result.surveys });
          return;
        }
        setList({
          status: "error",
          reason: result.status,
        });
      });
    },
    [teamId],
  );

  async function toggle(surveyId: string) {
    if (openId === surveyId) {
      setOpenId(null);
      return;
    }
    setOpenId(surveyId);
    const token = tokenRef.current;
    if (!token || results[surveyId]) {
      return;
    }
    const result = await fetchSurveyResults(token, teamId, surveyId);
    setResults((previous) => ({ ...previous, [surveyId]: result }));
  }

  return (
    <Card as="section" variant="bordered" padding="md" aria-labelledby="team-survey-results-heading">
      <div className="flex flex-col gap-4">
        <div>
          <h2 id="team-survey-results-heading" className="text-lg font-semibold text-text-primary">
            {builderCopy.teamResults.heading}
          </h2>
          <p className="text-help text-text-muted">{builderCopy.teamResults.hint}</p>
        </div>

        {list.status === "loading" ? <LoadingState label={builderCopy.teamResults.loading} /> : null}

        {list.status === "error" ? (
          <Alert variant={list.reason === "read_failed" ? "error" : "info"}>
            {list.reason === "forbidden"
              ? builderCopy.teamResults.forbidden
              : list.reason === "unauthenticated"
                ? builderCopy.workspace.unauthenticated
                : builderCopy.teamResults.loadFailed}
          </Alert>
        ) : null}

        {list.status === "ready" && list.surveys.length === 0 ? (
          <EmptyState>{builderCopy.teamResults.empty}</EmptyState>
        ) : null}

        {list.status === "ready" && list.surveys.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {list.surveys.map((survey) => {
              const isOpen = openId === survey.surveyId;
              const title = survey.title && survey.title.trim() !== "" ? survey.title : builderCopy.workspace.groups.closed.title;
              const detailsId = `survey-results-${survey.surveyId}`;
              return (
                <li key={survey.surveyId} className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="break-words font-medium text-text-primary">{title}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-expanded={isOpen}
                      aria-controls={detailsId}
                      onClick={() => void toggle(survey.surveyId)}
                    >
                      {isOpen ? builderCopy.teamResults.hide : builderCopy.teamResults.show}
                    </Button>
                  </div>
                  {isOpen ? (
                    <div id={detailsId}>
                      {results[survey.surveyId] ? (
                        <ResultsBody result={results[survey.surveyId]} />
                      ) : (
                        <LoadingState label={builderCopy.results.loading} />
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}
