"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { teamProjectsCopy } from "../copy";
import { PROJECT_LIFECYCLE_STATUSES, PROJECT_PRIORITIES, validateProjectFields, type ProjectValidationIssue } from "../domain/team-project";
import type { ClientTeamProject, ProjectWriteInput } from "../client/team-projects-gateway";

interface ProjectFormProps {
  /** `null` creates a project; an existing project is edited. */
  project: ClientTeamProject | null;
  busy: boolean;
  /** Server-side failure message for the last submit, if any. */
  serverError: string | null;
  onSubmit: (input: ProjectWriteInput) => void;
  onCancel: () => void;
}

/**
 * Create or edit form for one team project (TASK-005). Client checks reuse the domain validator, so the messages match
 * the server rules; the server still validates every write. The heading takes focus when the form opens.
 */
export function ProjectForm({ project, busy, serverError, onSubmit, onCancel }: ProjectFormProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formId = useId();
  const [title, setTitle] = useState(project?.title ?? "");
  const [startDate, setStartDate] = useState(project?.startDate ?? "");
  const [endDate, setEndDate] = useState(project?.endDate ?? "");
  const [lifecycleStatus, setLifecycleStatus] = useState(project?.lifecycleStatus ?? "planned");
  const [priority, setPriority] = useState(project?.priority ?? "medium");
  const [issues, setIssues] = useState<ProjectValidationIssue[]>([]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function issueText(issue: ProjectValidationIssue): string {
    return teamProjectsCopy.issues[issue];
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validateProjectFields({ title, startDate, endDate, lifecycleStatus, priority });
    if (!checked.ok) {
      setIssues(checked.issues);
      return;
    }
    setIssues([]);
    onSubmit(checked.value);
  }

  const has = (issue: ProjectValidationIssue) => issues.includes(issue);
  const heading = project ? teamProjectsCopy.form.editHeading : teamProjectsCopy.form.createHeading;

  return (
    <section aria-labelledby={`${formId}-heading`} className="rounded-control border border-border-subtle bg-surface p-4">
      <h3 id={`${formId}-heading`} ref={headingRef} tabIndex={-1} className="text-section font-semibold text-text-primary focus:outline-none">
        {heading}
      </h3>
      <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit} noValidate>
        <div className="md:col-span-2">
          <TextField
            id={`${formId}-title`}
            label={teamProjectsCopy.form.title}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            error={has("title_required") ? issueText("title_required") : has("title_too_long") ? issueText("title_too_long") : undefined}
            maxLength={200}
            autoComplete="off"
          />
        </div>
        <TextField
          id={`${formId}-start`}
          label={teamProjectsCopy.form.startDate}
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          error={has("start_date_invalid") ? issueText("start_date_invalid") : undefined}
        />
        <TextField
          id={`${formId}-end`}
          label={teamProjectsCopy.form.endDate}
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          error={has("end_date_invalid") ? issueText("end_date_invalid") : has("end_before_start") ? issueText("end_before_start") : undefined}
        />
        <Select
          id={`${formId}-status`}
          label={teamProjectsCopy.form.lifecycleStatus}
          value={lifecycleStatus}
          onChange={(event) => setLifecycleStatus(event.target.value as typeof lifecycleStatus)}
          error={has("lifecycle_status_invalid") ? issueText("lifecycle_status_invalid") : undefined}
        >
          {PROJECT_LIFECYCLE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {teamProjectsCopy.lifecycleOptions[status]}
            </option>
          ))}
        </Select>
        <Select
          id={`${formId}-priority`}
          label={teamProjectsCopy.form.priority}
          value={priority}
          onChange={(event) => setPriority(event.target.value as typeof priority)}
          error={has("priority_invalid") ? issueText("priority_invalid") : undefined}
        >
          {PROJECT_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {teamProjectsCopy.priority[value]}
            </option>
          ))}
        </Select>
        {serverError ? (
          <div className="md:col-span-2">
            <Alert variant="error">{serverError}</Alert>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="submit" variant="primary" disabled={busy} pending={busy} aria-busy={busy || undefined}>
            {teamProjectsCopy.actions.save}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {teamProjectsCopy.actions.cancel}
          </Button>
        </div>
      </form>
    </section>
  );
}
