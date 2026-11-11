import { Check, CircleDashed, Circle } from "lucide-react";
import { Alert } from "../../../components/ui/Alert";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { MILESTONE_STATUS_LABEL, competencePlanCopy } from "../copy";
import type { PlanMilestone } from "../domain/competence-plan";
import { formatPlanDate, isMilestoneOverdue } from "../domain/plan-presentation";

export interface PlanMilestoneChecklistProps {
  /** Used only to name each control, e.g. "Merk fullført: Testdesign". */
  areaName: string;
  milestones: readonly PlanMilestone[];
  /** ISO day (`YYYY-MM-DD`) used to flag overdue steps. Passed in so the list stays deterministic. */
  today: string;
  /** Team administrators may complete or reopen a step. Members see the status read-only. */
  canEdit: boolean;
  /** Id of the step whose save is in flight in this plan, if any. */
  pendingMilestoneId: string | null;
  /** True while any save is in flight anywhere on the page; all controls wait for it. */
  busy: boolean;
  /** Set when the last save for this plan was refused. */
  saveFailed: boolean;
  onToggle: (milestone: PlanMilestone) => void;
}

const STATUS_ICON = {
  planned: Circle,
  in_progress: CircleDashed,
  completed: Check,
} as const;

/**
 * Milestones of one competence plan (inside its expandable card). Status is always spelled out in text and by the icon
 * shape; colour is never the only signal. Only a team administrator gets the complete/reopen control.
 */
export function PlanMilestoneChecklist({
  areaName,
  milestones,
  today,
  canEdit,
  pendingMilestoneId,
  busy,
  saveFailed,
  onToggle,
}: PlanMilestoneChecklistProps) {
  if (milestones.length === 0) {
    return <p className="text-sm text-text-secondary">{competencePlanCopy.milestonesEmpty}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-text-primary">{competencePlanCopy.checklistHeading}</h4>
      {canEdit ? null : <p className="text-xs text-text-secondary">{competencePlanCopy.milestoneReadOnly}</p>}
      <ul aria-label={competencePlanCopy.checklistHeading} className="flex flex-col gap-2">
        {milestones.map((milestone) => {
          const completed = milestone.status === "completed";
          const overdue = isMilestoneOverdue(milestone, today);
          const saving = pendingMilestoneId === milestone.id;
          const date = formatPlanDate(milestone.targetDate);
          const action = completed ? competencePlanCopy.milestoneReopen : competencePlanCopy.milestoneComplete;
          return (
            <li key={milestone.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-field border border-border-subtle px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Icon
                  icon={STATUS_ICON[milestone.status]}
                  size="inline"
                  className={completed ? "shrink-0 text-success-text" : "shrink-0 text-text-secondary"}
                />
                <span className={"min-w-0 break-words " + (completed ? "text-text-secondary line-through" : "text-text-primary")}>
                  {milestone.title}
                </span>
                <span className="sr-only">{`(${MILESTONE_STATUS_LABEL[milestone.status]})`}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-secondary">{date ?? competencePlanCopy.milestoneNoDate}</span>
                <Badge>{MILESTONE_STATUS_LABEL[milestone.status]}</Badge>
                {overdue ? <Badge>{competencePlanCopy.milestoneOverdue}</Badge> : null}
                {canEdit ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    aria-busy={saving || undefined}
                    aria-label={competencePlanCopy.milestoneTitleAction(action, `${milestone.title} (${areaName})`)}
                    onClick={() => onToggle(milestone)}
                  >
                    {saving ? competencePlanCopy.milestoneSaving : action}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {saveFailed ? <Alert variant="error" role="alert">{competencePlanCopy.milestoneSaveFailed}</Alert> : null}
    </div>
  );
}
