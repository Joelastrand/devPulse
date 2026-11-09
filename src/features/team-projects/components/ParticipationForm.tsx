"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { validateParticipationFields, type ParticipationValidationIssue } from "../domain/team-project-participation";
import { teamProjectsCopy } from "../copy";
import type { ClientMember, ClientTeamProject } from "../client/team-projects-gateway";
import type { ProjectParticipationView } from "../server/write-project-participation";

/** The complete assignment as the person chose it. The parent decides which fields go to the server. */
export interface ParticipationFormSubmit {
  memberRef: string;
  projectId: string;
  startDate: string;
  endDate: string;
}

interface ParticipationFormProps {
  /** `null` plans a new assignment; an existing assignment is edited. */
  assignment: ProjectParticipationView | null;
  /** Names of the assignment being edited, shown so the person knows which record the form changes. */
  currentLabel: { member: string; project: string } | null;
  members: ClientMember[];
  /** Active projects only. Archived projects cannot receive participation. */
  projects: ClientTeamProject[];
  busy: boolean;
  serverError: string | null;
  onSubmit: (input: ParticipationFormSubmit) => void;
  /** Removal is a soft archive; the parent performs the write once the person confirms. */
  onRemove: () => void;
  onCancel: () => void;
}

/**
 * Plan or edit one member's participation (TASK-005, SPEC BR-8). Member, project and dates are all editable for an
 * existing assignment, so one save can move it to another member or project. Client checks reuse the participation
 * domain validator and check that the chosen member and project are in the lists the person can pick from; the server
 * validates and authorizes every write. Removal asks for confirmation first. The heading takes focus when the form opens.
 */
export function ParticipationForm({
  assignment,
  currentLabel,
  members,
  projects,
  busy,
  serverError,
  onSubmit,
  onRemove,
  onCancel,
}: ParticipationFormProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const formId = useId();
  const [memberRef, setMemberRef] = useState(assignment?.memberRef ?? "");
  const [projectId, setProjectId] = useState(assignment?.projectId ?? "");
  const [startDate, setStartDate] = useState(assignment?.startDate ?? "");
  const [endDate, setEndDate] = useState(assignment?.endDate ?? "");
  const [issues, setIssues] = useState<ParticipationValidationIssue[]>([]);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (confirmingRemove) confirmRef.current?.focus();
  }, [confirmingRemove]);

  const isEdit = assignment !== null;
  const has = (issue: ParticipationValidationIssue) => issues.includes(issue);
  const sortedMembers = [...members].sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "", "nb"));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validateParticipationFields({ projectId, memberRef, startDate, endDate });
    const found: ParticipationValidationIssue[] = [...(checked.ok ? [] : checked.issues)];
    // A choice must come from the lists on screen. A member who left the team, or an archived project, is not offered.
    if (!members.some((member) => member.memberRef === memberRef) && !found.includes("member_ref_invalid")) found.push("member_ref_invalid");
    if (!projects.some((project) => project.projectId === projectId) && !found.includes("project_id_required")) found.push("project_id_required");
    if (found.length > 0) {
      setIssues(found);
      return;
    }
    setIssues([]);
    onSubmit({ memberRef, projectId, startDate, endDate });
  }

  const heading = isEdit ? teamProjectsCopy.participationForm.editHeading : teamProjectsCopy.participationForm.createHeading;

  return (
    <section aria-labelledby={`${formId}-heading`} className="rounded-control border border-border-subtle bg-surface p-4">
      <h3 id={`${formId}-heading`} ref={headingRef} tabIndex={-1} className="text-section font-semibold text-text-primary focus:outline-none">
        {heading}
      </h3>

      {confirmingRemove ? (
        <div className="mt-4 flex flex-col gap-3">
          <p ref={confirmRef} tabIndex={-1} className="text-label font-medium text-text-primary focus:outline-none">
            {teamProjectsCopy.participationForm.confirmRemoveText}
          </p>
          {serverError ? <Alert variant="error">{serverError}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" disabled={busy} pending={busy} onClick={onRemove}>
              {teamProjectsCopy.participationForm.confirmRemove}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmingRemove(false)}>
              {teamProjectsCopy.participationForm.keepParticipation}
            </Button>
          </div>
        </div>
      ) : (
        <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit} noValidate>
          {isEdit && currentLabel ? (
            <p className="text-help text-text-secondary md:col-span-2">
              {teamProjectsCopy.participationForm.currentAssignment(currentLabel.member, currentLabel.project)}
            </p>
          ) : null}

          <Select
            id={`${formId}-member`}
            label={teamProjectsCopy.participationForm.member}
            value={memberRef}
            onChange={(event) => setMemberRef(event.target.value)}
            error={has("member_ref_invalid") ? teamProjectsCopy.participationIssues.member_ref_invalid : undefined}
            disabled={sortedMembers.length === 0}
          >
            <option value="">{teamProjectsCopy.participationForm.selectMember}</option>
            {sortedMembers.map((member) => (
              <option key={member.memberRef} value={member.memberRef}>
                {member.displayName ?? teamProjectsCopy.unnamedMember}
              </option>
            ))}
          </Select>

          <Select
            id={`${formId}-project`}
            label={teamProjectsCopy.participationForm.project}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            error={has("project_id_required") ? teamProjectsCopy.participationIssues.project_id_required : undefined}
            disabled={projects.length === 0}
          >
            <option value="">{teamProjectsCopy.participationForm.selectProject}</option>
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.title}
              </option>
            ))}
          </Select>

          <TextField
            id={`${formId}-start`}
            label={teamProjectsCopy.participationForm.startDate}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            error={has("start_date_invalid") ? teamProjectsCopy.participationIssues.start_date_invalid : undefined}
          />
          <TextField
            id={`${formId}-end`}
            label={teamProjectsCopy.participationForm.endDate}
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            error={
              has("end_date_invalid")
                ? teamProjectsCopy.participationIssues.end_date_invalid
                : has("end_before_start")
                  ? teamProjectsCopy.participationIssues.end_before_start
                  : undefined
            }
          />

          {issues.length > 0 || serverError !== null ? (
            <div className="md:col-span-2">
              <Alert variant="error">{serverError ?? teamProjectsCopy.participationIssues.generic}</Alert>
            </div>
          ) : null}

          {sortedMembers.length === 0 ? (
            <p className="text-help text-text-secondary md:col-span-2">{teamProjectsCopy.participationForm.noMembers}</p>
          ) : null}
          {projects.length === 0 ? (
            <p className="text-help text-text-secondary md:col-span-2">{teamProjectsCopy.participationForm.noProjects}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <Button type="submit" variant="primary" disabled={busy} pending={busy} aria-busy={busy || undefined}>
              {isEdit ? teamProjectsCopy.participationForm.saveChanges : teamProjectsCopy.participationForm.save}
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
              {teamProjectsCopy.participationForm.cancel}
            </Button>
            {isEdit ? (
              <Button type="button" variant="destructive" className="sm:ml-auto" disabled={busy} onClick={() => setConfirmingRemove(true)}>
                {teamProjectsCopy.participationForm.remove}
              </Button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
