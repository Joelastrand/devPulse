import type { AdminSurveyEntry } from "../../client/admin-survey-gateway";

/**
 * Workspace grouping (team-survey-builder TSB-006). Derived from the server's
 * lifecycle and archive flag, never stored. `scheduled` is shown as a draft
 * ("Utkast"): nothing opens it automatically.
 */
export type WorkspaceGroup = "draft" | "open" | "closed" | "archived";

export function groupOf(survey: AdminSurveyEntry): WorkspaceGroup {
  if (survey.archived) {
    return "archived";
  }
  if (survey.lifecycle === "open") {
    return "open";
  }
  if (survey.lifecycle === "closed") {
    return "closed";
  }
  return "draft";
}

export function groupSurveys(surveys: readonly AdminSurveyEntry[]): Record<WorkspaceGroup, AdminSurveyEntry[]> {
  const groups: Record<WorkspaceGroup, AdminSurveyEntry[]> = { draft: [], open: [], closed: [], archived: [] };
  for (const survey of surveys) {
    groups[groupOf(survey)].push(survey);
  }
  return groups;
}

/** A draft can be edited only while it has never been opened and is not archived. */
export function isEditableDraft(survey: AdminSurveyEntry): boolean {
  return groupOf(survey) === "draft";
}
