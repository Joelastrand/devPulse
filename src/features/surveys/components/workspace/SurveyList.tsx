"use client";

import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { StatusBadge, type StatusTone } from "../../../../components/ui/StatusBadge";
import type { AdminSurveyEntry } from "../../client/admin-survey-gateway";
import { builderCopy } from "../../builder-copy";
import { resolveSurveyQuestions } from "../../domain/survey";
import { groupSurveys, type WorkspaceGroup } from "./survey-groups";

export interface SurveyListActions {
  onEdit: (survey: AdminSurveyEntry) => void;
  onPreview: (survey: AdminSurveyEntry) => void;
  onDuplicate: (survey: AdminSurveyEntry) => void;
  onOpen: (survey: AdminSurveyEntry) => void;
  onClose: (survey: AdminSurveyEntry) => void;
  onArchive: (survey: AdminSurveyEntry) => void;
  onDeleteDraft: (survey: AdminSurveyEntry) => void;
  onEditDetails: (survey: AdminSurveyEntry) => void;
  onResults: (survey: AdminSurveyEntry) => void;
  onCopyLink: (survey: AdminSurveyEntry) => void;
}

const GROUP_ORDER: readonly WorkspaceGroup[] = ["draft", "open", "closed", "archived"];

const GROUP_TONE: Record<WorkspaceGroup, StatusTone> = {
  draft: "neutral",
  open: "success",
  closed: "info",
  archived: "neutral",
};

/**
 * The team survey overview, grouped into draft / open / closed / archived
 * (team-survey-builder TSB-006). Each state offers only the actions valid for
 * it. The server re-checks every action, so this filtering is presentation only.
 */
export function SurveyList({ surveys, actions }: { surveys: readonly AdminSurveyEntry[]; actions: SurveyListActions }) {
  if (surveys.length === 0) {
    return <p className="text-text-muted">{builderCopy.workspace.empty}</p>;
  }

  const groups = groupSurveys(surveys);

  return (
    <div className="flex flex-col gap-8">
      {GROUP_ORDER.map((group) => {
        const items = groups[group];
        if (items.length === 0) {
          return null;
        }
        const copy = builderCopy.workspace.groups[group];
        return (
          <section key={group} aria-labelledby={`group-${group}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 id={`group-${group}`} className="text-lg font-semibold text-text-primary">
                {copy.title}
              </h2>
              <StatusBadge tone={GROUP_TONE[group]}>{items.length}</StatusBadge>
              <p className="text-help text-text-muted">{copy.hint}</p>
            </div>
            <ul className="flex flex-col gap-3">
              {items.map((survey) => (
                <li key={survey.surveyId}>
                  <SurveyRow group={group} survey={survey} actions={actions} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SurveyRow({
  group,
  survey,
  actions,
}: {
  group: WorkspaceGroup;
  survey: AdminSurveyEntry;
  actions: SurveyListActions;
}) {
  const questionCount = resolveSurveyQuestions(survey).length;
  const title = survey.title && survey.title.trim() !== "" ? survey.title : builderCopy.workspace.groups[group].title;
  const planned = group === "draft" && survey.startAt ? builderCopy.workspace.plannedStart(formatDate(survey.startAt)) : null;

  return (
    <Card as="div" variant="bordered" padding="md" aria-label={title}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-text-primary">{title}</h3>
          <p className="text-help text-text-muted">
            {builderCopy.workspace.questionCount(questionCount)} · {builderCopy.workspace.accessModeHint[survey.accessMode]}
            {" · "}
            {`Resultater vises fra ${survey.minimumResponses} svar`}
          </p>
          {planned ? <p className="text-help text-text-secondary">{planned}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {group === "draft" ? (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => actions.onEdit(survey)}>
                {builderCopy.workspace.actions.edit}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => actions.onPreview(survey)}>
                {builderCopy.workspace.actions.preview}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => actions.onDuplicate(survey)}>
                {builderCopy.workspace.actions.duplicate}
              </Button>
              <Button type="button" size="sm" variant="destructive" onClick={() => actions.onDeleteDraft(survey)}>
                {builderCopy.workspace.actions.delete}
              </Button>
              <Button type="button" size="sm" onClick={() => actions.onOpen(survey)}>
                {builderCopy.workspace.actions.open}
              </Button>
            </>
          ) : null}
          {group === "open" ? (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => actions.onCopyLink(survey)}>
                {builderCopy.workspace.actions.copyLink}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => actions.onDuplicate(survey)}>
                {builderCopy.workspace.actions.duplicate}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => actions.onEditDetails(survey)}>
                {builderCopy.workspace.actions.editDetails}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => actions.onResults(survey)}>
                {builderCopy.workspace.actions.results}
              </Button>
              <Button type="button" size="sm" variant="destructive" onClick={() => actions.onClose(survey)}>
                {builderCopy.workspace.actions.close}
              </Button>
            </>
          ) : null}
          {group === "closed" ? (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => actions.onEditDetails(survey)}>
                {builderCopy.workspace.actions.editDetails}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => actions.onResults(survey)}>
                {builderCopy.workspace.actions.results}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => actions.onDuplicate(survey)}>
                {builderCopy.workspace.actions.duplicate}
              </Button>
              <Button type="button" size="sm" variant="tertiary" onClick={() => actions.onArchive(survey)}>
                {builderCopy.workspace.actions.archive}
              </Button>
            </>
          ) : null}
          {group === "archived" ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => actions.onResults(survey)}>
              {builderCopy.workspace.actions.results}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
