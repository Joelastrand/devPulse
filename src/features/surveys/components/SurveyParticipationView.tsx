"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { LoadingState } from "../../../components/ui/LoadingState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  fetchSurveyParticipation,
  type SurveyParticipationFetchResult,
} from "../client/survey-participation-gateway";
import { surveysCopy } from "../copy";
import { SurveyResponseForm } from "./SurveyResponseForm";

type ViewState =
  | { phase: "loading" }
  | { phase: "loaded"; token: string | null; result: SurveyParticipationFetchResult };

/**
 * `/survey/{surveyId}` for both access modes
 * (docs/features/managed-surveys/SPEC.md — BR-10, BR-12, BR-13, BR-20's UI
 * half). Renders purely from TASK-005's resolved outcome (via the thin
 * `GET /api/surveys/[surveyId]` route) — no lifecycle, access-mode, or
 * membership logic is duplicated here (`.claude/rules/security.md` —
 * never rely on UI filtering for authorization). The form
 * (`SurveyResponseForm`) is rendered only for the `answerable` outcome.
 *
 * Mirrors `TeamDetail`'s `useAuthGatedResource` + monotonic-generation
 * pattern, extended to also guard against a route change via `surveyId` as
 * an extra reset dependency. Unlike `TeamDetail`, a `null` token is not
 * itself a terminal "signed out" state — a `public` survey resolves and
 * renders identically regardless of auth state, so this component always
 * asks the server, with whatever token (or none) is currently available.
 */
export function SurveyParticipationView({ surveyId }: { surveyId: string }) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });

  useAuthGatedResource(
    (token, generation, isCurrentGeneration) => {
      setState({ phase: "loading" });
      fetchSurveyParticipation(surveyId, token ?? undefined).then((result) => {
        if (isCurrentGeneration(generation)) {
          setState({ phase: "loaded", token, result });
        }
      });
    },
    [surveyId],
  );

  if (state.phase === "loading") {
    return <LoadingState label={surveysCopy.page.loading} />;
  }

  const { result, token } = state;

  if (result.status === "read_failed") {
    return <Alert variant="error">{surveysCopy.page.readFailed}</Alert>;
  }

  if (result.status === "not_found") {
    return <Alert variant="info">{surveysCopy.page.notFound}</Alert>;
  }

  if (result.status === "sign_in_required") {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        <Link
          href={`/sign-in?continue=${encodeURIComponent(`/survey/${surveyId}`)}`}
          className="font-medium text-zinc-900 underline dark:text-zinc-50"
        >
          {surveysCopy.page.signInLink}
        </Link>{" "}
        {surveysCopy.page.signInRequired}
      </p>
    );
  }

  if (result.status === "forbidden") {
    return <Alert variant="info">{surveysCopy.page.forbidden}</Alert>;
  }

  const { survey } = result;
  const title = survey.title ?? surveysCopy.page.fallbackTitle;

  if (result.status === "scheduled") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={title} description={survey.teamName} />
        <Alert variant="info">{surveysCopy.page.scheduled}</Alert>
      </div>
    );
  }

  if (result.status === "closed") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={title} description={survey.teamName} />
        <Alert variant="info">{surveysCopy.page.closed}</Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={survey.teamName} />
      <SurveyResponseForm surveyId={surveyId} idToken={token} />
    </div>
  );
}
