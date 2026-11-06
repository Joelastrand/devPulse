"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { Section } from "../../../components/ui/Section";
import { TeamPageHeader } from "../../teams/components/TeamPageHeader";
import { teamsCopy } from "../../teams/copy";
import { useTeamProjectRoadmap } from "../client/use-team-project-roadmap";
import {
  writeTeamProject,
  type ClientTeamProject,
  type ProjectWriteAction,
  type ProjectWriteInput,
  type ProjectWriteResult,
} from "../client/team-projects-gateway";
import { teamProjectsCopy } from "../copy";
import { formatPlanDateNb, type ParticipationInput } from "../domain/project-roadmap-view";
import { buildTimelineWindow, TIMELINE_WINDOW_MONTHS, type TimelineWindowMonths } from "../domain/timeline-geometry";
import { planningToday } from "../../roadmap/domain/roadmap-dates";
import type { ProjectParticipationView } from "../server/write-project-participation";
import { ParticipationPanel } from "./ParticipationPanel";
import { ProjectForm } from "./ProjectForm";
import { ProjectGantt } from "./ProjectGantt";

type EditState = { mode: "create" } | { mode: "edit"; project: ClientTeamProject } | null;

/**
 * `/teams/[teamId]/roadmap` (TASK-005, reference 19). Project plan with a 3- or 6-month Gantt, project create, edit,
 * archive and restore for team leads, and the planned participation of members. Every number and bar comes from the
 * project and participation APIs; nothing is estimated or invented. Lead-only controls are hidden for members, and the
 * server enforces the same rule on every write.
 */
export function TeamProjectRoadmap({ teamId }: { teamId: string }) {
  const { auth, data, reload } = useTeamProjectRoadmap(teamId);
  const [months, setMonths] = useState<TimelineWindowMonths>(6);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<EditState>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Fixed for the lifetime of this view; the planning calendar date is the anchor for the window and the today marker.
  const [today] = useState(() => planningToday(new Date()));
  const timelineWindow = buildTimelineWindow(today, months);
  const participations = data.phase === "loaded" ? toParticipationInputs(data.projects, data.participations) : [];

  if (auth.phase === "loading") {
    return <LoadingState label={teamProjectsCopy.loading} />;
  }

  if (auth.phase === "signed_out") {
    return (
      <p className="text-text-secondary">
        <Link href="/sign-in" className="font-medium text-text-primary underline">
          {teamsCopy.detail.signInLink}
        </Link>{" "}
        {teamsCopy.detail.signInPrompt}
      </p>
    );
  }

  const token = auth.token;

  async function runWrite(action: ProjectWriteAction, projectId: string | null, input: ProjectWriteInput | null) {
    setBusyProjectId(projectId ?? "new");
    setFormError(null);
    setActionError(null);
    const result: ProjectWriteResult = await writeTeamProject(token, teamId, action, projectId, input);
    setBusyProjectId(null);

    if (result.status === "ok") {
      setEditing(null);
      reload();
      return;
    }
    const message = writeErrorMessage(result.status);
    if (action === "create" || action === "update") {
      setFormError(message);
    } else {
      setActionError(message);
    }
  }

  function renderBody() {
    if (data.phase === "loading") return <LoadingState label={teamProjectsCopy.loading} />;

    if (data.phase === "error") {
      return (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">
            {data.reason === "forbidden" ? teamProjectsCopy.errors.forbidden : teamProjectsCopy.errors.loadProjects}
          </Alert>
          {data.reason === "forbidden" ? null : (
            <Button type="button" variant="secondary" onClick={reload}>
              {teamProjectsCopy.actions.retry}
            </Button>
          )}
        </div>
      );
    }

    const activeProjects = data.projects.filter((project) => !project.archived);
    const archivedProjects = data.projects.filter((project) => project.archived);

    return (
      <div className="flex flex-col gap-6">
        {data.truncated ? <Alert variant="info">{teamProjectsCopy.truncated}</Alert> : null}
        {actionError ? <Alert variant="error">{actionError}</Alert> : null}

        {editing ? (
          <ProjectForm
            key={editing.mode === "edit" ? editing.project.projectId : "create"}
            project={editing.mode === "edit" ? editing.project : null}
            busy={busyProjectId !== null}
            serverError={formError}
            onCancel={() => {
              setEditing(null);
              setFormError(null);
            }}
            onSubmit={(input) =>
              void runWrite(
                editing.mode === "edit" ? "update" : "create",
                editing.mode === "edit" ? editing.project.projectId : null,
                input,
              )
            }
          />
        ) : null}

        {activeProjects.length === 0 ? (
          <EmptyState>
            {teamProjectsCopy.empty.projects}
            {data.canEdit ? ` ${teamProjectsCopy.empty.projectsLead}` : ""}
          </EmptyState>
        ) : (
          <ProjectGantt
            window={timelineWindow}
            today={today}
            projects={activeProjects}
            canEdit={data.canEdit}
            busyProjectId={busyProjectId}
            onEdit={(project) => {
              setFormError(null);
              setEditing({ mode: "edit", project });
            }}
            onArchive={(project) => void runWrite("archive", project.projectId, null)}
          />
        )}

        {showArchived ? (
          <section aria-labelledby="archived-projects-heading" className="flex flex-col gap-3">
            <h3 id="archived-projects-heading" className="text-label font-semibold text-text-primary">
              {teamProjectsCopy.archivedHeading}
            </h3>
            {archivedProjects.length === 0 ? (
              <p className="text-label text-text-secondary">{teamProjectsCopy.empty.projects}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {archivedProjects.map((project) => (
                  <li key={project.projectId} className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface-subtle px-4 py-3">
                    <span className="text-label text-text-primary">
                      {`${project.title} · ${formatPlanDateNb(project.startDate)} – ${formatPlanDateNb(project.endDate)}`}
                    </span>
                    {data.canEdit ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busyProjectId !== null}
                        onClick={() => void runWrite("restore", project.projectId, null)}
                        aria-label={`${teamProjectsCopy.actions.restore}: ${project.title}`}
                      >
                        {teamProjectsCopy.actions.restore}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <TeamPageHeader teamId={teamId} />

      <Section
        title={teamProjectsCopy.section.plan}
        description={teamProjectsCopy.section.planDescription}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={teamProjectsCopy.window.label} className="inline-flex rounded-control border border-border-strong p-0.5">
              {TIMELINE_WINDOW_MONTHS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={months === value ? "primary" : "tertiary"}
                  size="sm"
                  aria-pressed={months === value}
                  onClick={() => setMonths(value)}
                >
                  {value === 3 ? teamProjectsCopy.window.threeMonths : teamProjectsCopy.window.sixMonths}
                </Button>
              ))}
            </div>
            {data.phase === "loaded" && data.canEdit && editing === null ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  setFormError(null);
                  setEditing({ mode: "create" });
                }}
              >
                {teamProjectsCopy.actions.create}
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="rounded-surface border border-border-subtle bg-surface p-4 shadow-card">
          {renderBody()}
          {data.phase === "loaded" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
              <Button type="button" variant="tertiary" size="sm" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
                {showArchived ? teamProjectsCopy.actions.hideArchived : teamProjectsCopy.actions.showArchived}
              </Button>
              {!data.canEdit ? <span className="text-help text-text-secondary">{teamProjectsCopy.readOnlyNote}</span> : null}
            </div>
          ) : null}
        </div>
      </Section>

      {data.phase === "loaded" ? (
        <Section title={teamProjectsCopy.section.participation} description={teamProjectsCopy.section.participationDescription}>
          <div className="rounded-surface border border-border-subtle bg-surface p-4 shadow-card">
            {data.participationsFailed ? (
              <Alert variant="error">{teamProjectsCopy.errors.loadParticipation}</Alert>
            ) : (
              <ParticipationPanel
                window={timelineWindow}
                today={today}
                participations={participations}
                members={data.members}
                membersFailed={data.membersFailed}
              />
            )}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

/** Participations of active projects only, labelled with the project title. Unknown projects are dropped. */
function toParticipationInputs(projects: ClientTeamProject[], participations: ProjectParticipationView[]): ParticipationInput[] {
  const titleById = new Map(projects.filter((project) => !project.archived).map((project) => [project.projectId, project.title]));
  return participations.flatMap((participation) => {
    const projectTitle = titleById.get(participation.projectId);
    if (projectTitle === undefined) return [];
    return [{ ...participation, projectTitle }];
  });
}

function writeErrorMessage(status: Exclude<ProjectWriteResult["status"], "ok">): string {
  switch (status) {
    case "invalid_input":
      return teamProjectsCopy.issues.generic;
    case "forbidden":
      return teamProjectsCopy.errors.writeForbidden;
    case "conflict":
      return teamProjectsCopy.errors.writeConflict;
    case "not_found":
      return teamProjectsCopy.errors.writeNotFound;
    default:
      return teamProjectsCopy.errors.writeFailed;
  }
}
