import { Badge } from "../../../components/ui/Badge";
import { roadmapCopy } from "../copy";
import type { RoadmapItemView, RoadmapOwner } from "../server/list-roadmap-items";

/** `YYYY-MM-DD` → `DD.MM.YYYY` by string rearrangement only (no timezone involved). */
export function formatPlanDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function periodText(startDate: string | null, targetDate: string | null): string {
  const { from, to, none } = roadmapCopy.period;
  if (startDate !== null && targetDate !== null) {
    return `${formatPlanDate(startDate)} – ${formatPlanDate(targetDate)}`;
  }
  if (startDate !== null) return `${from} ${formatPlanDate(startDate)}`;
  if (targetDate !== null) return `${to} ${formatPlanDate(targetDate)}`;
  return none;
}

/** `Alex (2) · Deg` — name, ordinal and self marker; never an identifier. */
export function formatOwnerName(displayName: string | null, ordinal: number | null, isSelf: boolean): string {
  const { unnamed, self } = roadmapCopy.owner;
  const name = displayName ?? unnamed;
  const named = ordinal === null ? name : `${name} (${ordinal})`;
  return isSelf ? `${named} · ${self}` : named;
}

export function ownerText(owner: RoadmapOwner): string {
  const { none, unavailable } = roadmapCopy.owner;
  if (owner === null) return none;
  if (owner.state === "unavailable") return unavailable;
  return formatOwnerName(owner.displayName, owner.ordinal, owner.isSelf);
}

/**
 * Read-only plan line for one Kompetanseområde (docs/features/
 * team-skill-planning/SPEC.md — BR-30). Presentation only: it renders exactly
 * the DTO it is given. The target label is never replaced by the raw node id;
 * `targetReached` shows only when it is literally `true` (absent means "not
 * derivable", never "false"); `overdue` is independent of both. Names and
 * labels are rendered as inert React text. The opaque `memberRef` is not
 * rendered.
 */
export function RoadmapPlanSummary({ plan }: { plan: RoadmapItemView }) {
  const { labels, indicators } = roadmapCopy;
  const targetText =
    plan.targetAvailable && plan.targetLabel !== null ? plan.targetLabel : roadmapCopy.targetUnavailable;

  return (
    <div className="flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-300">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        <PlanField label={labels.target} value={targetText} />
        <PlanField label={labels.priority} value={roadmapCopy.priority[plan.priority]} />
        <PlanField label={labels.period} value={periodText(plan.startDate, plan.targetDate)} />
        <PlanField label={labels.owner} value={ownerText(plan.owner)} />
        <PlanField label={labels.status} value={roadmapCopy.status[plan.status]} />
      </dl>
      {(plan.targetReached === true || plan.overdue || plan.archived) && (
        <ul className="flex flex-wrap items-center gap-2">
          {plan.archived && (
            <li>
              <Badge>{indicators.archived}</Badge>
            </li>
          )}
          {plan.targetReached === true && (
            <li>
              <Badge>{indicators.targetReached}</Badge>
              {plan.status !== "completed" && <span className="ml-2">{indicators.targetReachedHint}</span>}
            </li>
          )}
          {plan.overdue && (
            <li>
              <Badge>{indicators.overdue}</Badge>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function PlanField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="inline font-medium text-zinc-900 dark:text-zinc-50">{label}: </dt>
      <dd className="inline break-words">{value}</dd>
    </div>
  );
}
