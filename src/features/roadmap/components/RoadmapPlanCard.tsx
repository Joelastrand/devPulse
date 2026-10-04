import { Badge } from "../../../components/ui/Badge";
import { roadmapCopy } from "../copy";
import { isLegacyReadOnlyPlan, planEditingContext, type TrackedAreaFacts } from "../domain/roadmap-mutation";
import type { RoadmapItemView } from "../server/list-roadmap-items";
import type { PlanningActions } from "./RoadmapPlanning";
import { AreaPlanEditor } from "./RoadmapPlanEditor";
import { formatPlanDate, ownerText } from "./RoadmapPlanSummary";

/**
 * Page-level mutation capability handed to every card/row. Present only when
 * `canMutate` (`canEdit` AND skills loaded); `null` means no mutation control
 * anywhere. Per-item eligibility is decided by `planEditingContext`.
 */
export interface RoadmapEditing {
  trackedAreas: readonly TrackedAreaFacts[];
  actions: PlanningActions;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Date part of an ISO timestamp, or `null` when absent/unusable — never a synthesized value. */
function timestampDate(value: string | null): string | null {
  if (value === null) return null;
  const date = value.slice(0, 10);
  return ISO_DATE.test(date) ? date : null;
}

/**
 * Read-only list card for one plan (SPEC BR-10a). Presentation only: renders
 * exactly the DTO fields, every meaning as text. `completedAt === null` on a
 * completed plan (legacy data) renders as completed without a date. The opaque
 * `memberRef` is never rendered. Used by both list and timeline, so the
 * existing editor (embedded) appears identically in both views — only when the
 * page can mutate and this item is eligible.
 */
export function RoadmapPlanCard({ plan, editing = null }: { plan: RoadmapItemView; editing?: RoadmapEditing | null }) {
  const { labels, indicators, page } = roadmapCopy;
  const editingContext = editing
    ? planEditingContext(plan, editing.trackedAreas, roadmapCopy.untracked.unnamedArea)
    : null;
  const targetText =
    plan.targetAvailable && plan.targetLabel !== null ? plan.targetLabel : roadmapCopy.targetUnavailable;
  const updated = timestampDate(plan.updatedAt);
  const completed = plan.status === "completed" ? timestampDate(plan.completedAt) : null;
  const hasDates = plan.startDate !== null || plan.targetDate !== null;

  return (
    <article className="flex flex-col gap-2 rounded border border-zinc-200 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
      <h3 className="break-words text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {plan.areaName ?? page.unknownArea}
      </h3>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        <CardField label={labels.target} value={targetText} />
        <CardField label={labels.status} value={roadmapCopy.status[plan.status]} />
        <CardField label={labels.priority} value={roadmapCopy.priority[plan.priority]} />
        {plan.startDate !== null && <CardDate label={page.startDate} value={plan.startDate} />}
        {plan.targetDate !== null && <CardDate label={page.targetDate} value={plan.targetDate} />}
        {!hasDates && <CardField label={labels.period} value={roadmapCopy.period.none} />}
        <CardField label={labels.owner} value={ownerText(plan.owner)} />
      </dl>
      <ul className="flex flex-wrap items-center gap-2">
        {plan.archived && (
          <li>
            <Badge>{indicators.archived}</Badge>
          </li>
        )}
        {plan.tracking.state === "not_tracked" && (
          <li>
            <Badge>{indicators.untracked}</Badge>
          </li>
        )}
        {plan.targetReached === true && (
          <li>
            <Badge>{indicators.targetReached}</Badge>
          </li>
        )}
        {plan.overdue && (
          <li>
            <Badge>{indicators.overdue}</Badge>
          </li>
        )}
        {updated !== null && (
          <li>
            {page.updated} <time dateTime={updated}>{formatPlanDate(updated)}</time>
          </li>
        )}
        {completed !== null && (
          <li>
            {page.completed} <time dateTime={completed}>{formatPlanDate(completed)}</time>
          </li>
        )}
      </ul>
      {plan.tracking.state === "not_tracked" && !isLegacyReadOnlyPlan(plan) && (
        <p className="text-zinc-600 dark:text-zinc-400">{roadmapCopy.untracked.explanation}</p>
      )}
      {isLegacyReadOnlyPlan(plan) && <p className="text-zinc-600 dark:text-zinc-400">{page.legacyReadOnly}</p>}
      {editing && editingContext && (
        <AreaPlanEditor
          embedded
          area={editingContext.area}
          plan={plan}
          canEdit
          actions={editing.actions}
          targetLocked={editingContext.targetLocked}
        />
      )}
    </article>
  );
}

function CardField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="inline font-medium text-zinc-900 dark:text-zinc-50">{label}: </dt>
      <dd className="inline break-words">{value}</dd>
    </div>
  );
}

function CardDate({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="inline font-medium text-zinc-900 dark:text-zinc-50">{label}: </dt>
      <dd className="inline">
        <time dateTime={value}>{formatPlanDate(value)}</time>
      </dd>
    </div>
  );
}
