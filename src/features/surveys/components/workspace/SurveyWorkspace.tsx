"use client";

import { useRef, useState } from "react";
import { Alert } from "../../../../components/ui/Alert";
import { Button } from "../../../../components/ui/Button";
import { LoadingState } from "../../../../components/ui/LoadingState";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { useAuthGatedResource } from "../../../auth/client/use-auth-gated-resource";
import {
  closeAdminSurvey,
  deleteOrArchiveAdminSurvey,
  fetchAdminSurveys,
  openAdminSurvey,
  type AdminSurveyEntry,
} from "../../client/admin-survey-gateway";
import {
  deleteDraftSurvey,
  duplicateSurvey,
  fetchSurveyResults,
  type SurveyResultsFetchResult,
} from "../../client/survey-builder-gateway";
import { builderCopy, validationMessage } from "../../builder-copy";
import { resolveSurveyQuestions } from "../../domain/survey";
import type { SurveyDraft } from "../../domain/survey-draft";
import { CreateSurveyPanel } from "./CreateSurveyPanel";
import { SurveyEditor } from "./SurveyEditor";
import { SurveyList } from "./SurveyList";
import { SurveyResultsPanel } from "./SurveyResultsPanel";
import { SurveyResponseForm } from "../SurveyResponseForm";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; surveys: AdminSurveyEntry[] }
  | { status: "error"; reason: "unauthenticated" | "forbidden" | "read_failed" };

type Feedback = { tone: "success" | "error"; text: string } | null;

type View =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; surveyId: string; detailsOnly: boolean }
  | { kind: "preview"; surveyId: string; draft: SurveyDraft | null }
  | { kind: "results"; surveyId: string; result: SurveyResultsFetchResult };

export interface SurveyWorkspaceProps {
  teamId: string;
}

/**
 * The team survey workspace at `/teams/[teamId]/surveys` (team-survey-builder
 * TSB-006). Loads the team's surveys through the admin endpoint, which enforces
 * app-admin access on the server. A non-admin gets a text outcome, not the
 * survey data. The component owns only view state and action wiring. Every
 * rule (lifecycle, freezing, threshold, authorization) lives on the server.
 */
export function SurveyWorkspace({ teamId }: SurveyWorkspaceProps) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [view, setView] = useState<View>({ kind: "list" });
  const [feedback, setFeedback] = useState<Feedback>(null);
  // The token is kept in state for rendering, and mirrored in a ref for event handlers.
  const [token, setToken] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const loadIdRef = useRef(0);

  async function loadSurveys(token: string) {
    const loadId = ++loadIdRef.current;
    const result = await fetchAdminSurveys(token, teamId);
    if (loadId !== loadIdRef.current) {
      return;
    }
    setLoad(result.status === "ok" ? { status: "ready", surveys: result.surveys } : { status: "error", reason: result.status });
  }

  useAuthGatedResource(
    (token) => {
      tokenRef.current = token;
      setToken(token);
      if (token === null) {
        setLoad({ status: "error", reason: "unauthenticated" });
        return;
      }
      setLoad({ status: "loading" });
      void loadSurveys(token);
    },
    [teamId],
  );

  function currentToken(): string | null {
    return tokenRef.current;
  }

  async function refresh() {
    const token = currentToken();
    if (token) {
      await loadSurveys(token);
    }
  }

  function surveyById(surveyId: string): AdminSurveyEntry | undefined {
    return load.status === "ready" ? load.surveys.find((survey) => survey.surveyId === surveyId) : undefined;
  }

  async function runLifecycleAction(
    action: (token: string) => Promise<{ ok: true } | { ok: false; error: string }>,
    successText: string,
  ) {
    const token = currentToken();
    if (!token) {
      return;
    }
    const result = await action(token);
    if (result.ok) {
      setFeedback({ tone: "success", text: successText });
      await refresh();
      return;
    }
    setFeedback({ tone: "error", text: validationMessage(result.error) });
  }

  const actions = {
    onEdit: (survey: AdminSurveyEntry) => {
      setFeedback(null);
      setView({ kind: "edit", surveyId: survey.surveyId, detailsOnly: false });
    },
    onEditDetails: (survey: AdminSurveyEntry) => {
      setFeedback(null);
      setView({ kind: "edit", surveyId: survey.surveyId, detailsOnly: true });
    },
    onDeleteDraft: (survey: AdminSurveyEntry) => {
      if (!window.confirm(builderCopy.workspace.confirm.delete)) {
        return;
      }
      void runLifecycleAction(
        (token) => deleteDraftSurvey(token, teamId, survey.surveyId),
        "Utkastet er slettet.",
      );
    },
    onPreview: (survey: AdminSurveyEntry) => setView({ kind: "preview", surveyId: survey.surveyId, draft: null }),
    onOpen: (survey: AdminSurveyEntry) => {
      if (!window.confirm(builderCopy.workspace.confirm.open)) {
        return;
      }
      void runLifecycleAction(
        (token) => openAdminSurvey(token, teamId, survey.surveyId),
        "Undersøkelsen er åpnet.",
      );
    },
    onClose: (survey: AdminSurveyEntry) => {
      if (!window.confirm(builderCopy.workspace.confirm.close)) {
        return;
      }
      void runLifecycleAction(
        (token) => closeAdminSurvey(token, teamId, survey.surveyId),
        "Undersøkelsen er avsluttet.",
      );
    },
    onArchive: (survey: AdminSurveyEntry) => {
      if (!window.confirm(builderCopy.workspace.confirm.archive)) {
        return;
      }
      void runLifecycleAction(
        async (token) => {
          const result = await deleteOrArchiveAdminSurvey(token, teamId, survey.surveyId);
          if (!result.ok) {
            return { ok: false, error: "unknown" };
          }
          return { ok: true };
        },
        "Undersøkelsen er fjernet eller arkivert.",
      );
    },
    onDuplicate: (survey: AdminSurveyEntry) => {
      const token = currentToken();
      if (!token) {
        return;
      }
      void (async () => {
        const result = await duplicateSurvey(token, teamId, survey.surveyId);
        if (!result.ok) {
          setFeedback({ tone: "error", text: validationMessage(result.error) });
          return;
        }
        await refresh();
        setFeedback({ tone: "success", text: "Kopien er laget som utkast." });
        setView({ kind: "edit", surveyId: result.surveyId, detailsOnly: false });
      })();
    },
    onResults: (survey: AdminSurveyEntry) => {
      const token = currentToken();
      if (!token) {
        return;
      }
      void (async () => {
        const result = await fetchSurveyResults(token, teamId, survey.surveyId);
        setView({ kind: "results", surveyId: survey.surveyId, result });
      })();
    },
    onCopyLink: (survey: AdminSurveyEntry) => {
      const link = `${window.location.origin}/survey/${encodeURIComponent(survey.surveyId)}`;
      navigator.clipboard
        .writeText(link)
        .then(() => setFeedback({ tone: "success", text: builderCopy.workspace.actions.copied }))
        .catch(() => setFeedback({ tone: "error", text: builderCopy.workspace.actions.copyFailed }));
    },
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={builderCopy.workspace.title} description={builderCopy.workspace.description} />

      {feedback ? <Alert variant={feedback.tone === "success" ? "success" : "error"}>{feedback.text}</Alert> : null}

      {load.status === "loading" ? <LoadingState label={builderCopy.workspace.loading} /> : null}

      {load.status === "error" ? (
        <Alert variant={load.reason === "read_failed" ? "error" : "info"}>
          {load.reason === "forbidden"
            ? builderCopy.workspace.forbidden
            : load.reason === "unauthenticated"
              ? builderCopy.workspace.unauthenticated
              : builderCopy.workspace.loadFailed}
        </Alert>
      ) : null}

      {load.status === "ready" && view.kind === "list" ? (
        <>
          <div>
            <Button type="button" onClick={() => setView({ kind: "create" })}>
              {builderCopy.workspace.newSurvey}
            </Button>
          </div>
          <SurveyList surveys={load.surveys} actions={actions} />
        </>
      ) : null}

      {load.status === "ready" && view.kind === "create" && token ? (
        <CreateSurveyPanel
          teamId={teamId}
          token={token}
          onCancel={() => setView({ kind: "list" })}
          onCreated={async (surveyId) => {
            await refresh();
            setFeedback({ tone: "success", text: builderCopy.create.created });
            setView({ kind: "edit", surveyId, detailsOnly: false });
          }}
        />
      ) : null}

      {load.status === "ready" && view.kind === "edit" && token ? (
        <EditView
          teamId={teamId}
          token={token}
          survey={surveyById(view.surveyId)}
          detailsOnly={view.detailsOnly}
          onBack={() => setView({ kind: "list" })}
          onSaved={refresh}
          onPreview={(draft) => setView({ kind: "preview", surveyId: view.surveyId, draft })}
        />
      ) : null}

      {load.status === "ready" && view.kind === "preview" ? (
        <PreviewView
          token={token}
          survey={surveyById(view.surveyId)}
          draft={view.draft}
          onBack={() => setView(view.draft ? { kind: "edit", surveyId: view.surveyId, detailsOnly: false } : { kind: "list" })}
        />
      ) : null}

      {load.status === "ready" && view.kind === "results" ? (
        <SurveyResultsPanel
          title={surveyById(view.surveyId)?.title ?? builderCopy.workspace.groups.closed.title}
          result={view.result}
          onBack={() => setView({ kind: "list" })}
        />
      ) : null}
    </div>
  );
}

function EditView({
  teamId,
  token,
  survey,
  detailsOnly,
  onBack,
  onSaved,
  onPreview,
}: {
  teamId: string;
  token: string;
  survey: AdminSurveyEntry | undefined;
  detailsOnly: boolean;
  onBack: () => void;
  onSaved: () => Promise<void>;
  onPreview: (draft: SurveyDraft) => void;
}) {
  if (!survey) {
    return <Alert variant="error">{builderCopy.editor.loadFailed}</Alert>;
  }
  return (
    <SurveyEditor
      key={survey.surveyId}
      teamId={teamId}
      token={token}
      survey={survey}
      detailsOnly={detailsOnly}
      onSaved={() => {
        void onSaved();
      }}
      onBack={onBack}
      onPreview={onPreview}
    />
  );
}

function PreviewView({
  token,
  survey,
  draft,
  onBack,
}: {
  token: string | null;
  survey: AdminSurveyEntry | undefined;
  draft: SurveyDraft | null;
  onBack: () => void;
}) {
  if (!survey) {
    return <Alert variant="error">{builderCopy.editor.loadFailed}</Alert>;
  }
  const questions = draft ? draft.questions : resolveSurveyQuestions(survey);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button type="button" variant="secondary" onClick={onBack}>
          {builderCopy.workspace.backToOverview}
        </Button>
      </div>
      <SurveyResponseForm surveyId={survey.surveyId} idToken={token} questions={questions} mode="preview" />
    </div>
  );
}
