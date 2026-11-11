import { Check } from "lucide-react";
import { Icon } from "../../../components/ui/Icon";
import { MILESTONE_STATUS_LABEL, PLAN_CARD_STATUS_LABEL, competencePlanCopy, planOverviewCopy } from "../copy";
import type { ClientCompetencePlan } from "../client/competence-plan-gateway";
import { planProgress, progressFillPercent } from "../domain/competence-plan";
import { planCardStatus, formatPlanDate } from "../domain/plan-presentation";
import { AREA_TONE_CLASSES, areaVisualFor } from "../domain/area-visual";
import type { PlanTimeline as PlanTimelineModel, TimelineMarker, TimelineSpan } from "../domain/plan-timeline";

/** Column width of the area label; the month columns share the rest of the row equally. */
const LABEL_COLUMN = "minmax(9rem,13rem)";

/**
 * Tooltip alignment for a marker: keep it inside the track at either end, centred elsewhere. Percent is the marker's
 * position in the window.
 */
function tooltipAlignment(pct: number): string {
  if (pct < 15) return "left-0";
  if (pct > 85) return "right-0";
  return "left-1/2 -translate-x-1/2";
}

function markerLabel(marker: TimelineMarker): string {
  const state = marker.status === "completed" ? planOverviewCopy.markerCompleted : planOverviewCopy.markerOpen;
  const date = formatPlanDate(marker.targetDate) ?? competencePlanCopy.milestoneNoDate;
  return `${marker.title}, ${date}, ${state}`;
}

/**
 * The plan timeline (reference 20). Two independent dimensions: where a plan's dated steps sit in time (bar position and
 * length, from the real dates) and how much of the plan is complete (the coloured share of the bar's neutral track).
 * Both use the same row geometry, so the markers and the bar stay aligned with the month columns.
 */
export function PlanTimeline({
  plans,
  nameOf,
  model,
  span,
}: {
  plans: readonly ClientCompetencePlan[];
  nameOf: (treeId: string) => string | null;
  model: PlanTimelineModel;
  span: TimelineSpan;
}) {
  const rowsByTree = new Map(model.rows.map((row) => [row.treeId, row]));
  const columns = `${LABEL_COLUMN} repeat(${span}, minmax(0,1fr))`;

  return (
    <div className="flex flex-col gap-4">
      {/* Horizontal scroll keeps the month columns aligned on narrow screens instead of squashing the dates. */}
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[36rem]" style={{ gridTemplateColumns: columns }}>
          <div className="border-b border-border-subtle py-2 pr-3 text-sm font-medium text-text-secondary">
            {planOverviewCopy.areaColumn}
          </div>
          {model.months.map((month) => (
            <div key={`${month.year}-${month.month}`} className="border-b border-l border-border-subtle py-2 pl-2 text-sm text-text-secondary">
              {new Intl.DateTimeFormat("nb-NO", { month: "short", year: "numeric", timeZone: "UTC" }).format(
                new Date(Date.UTC(month.year, month.month - 1, 1)),
              )}
            </div>
          ))}

          {plans.map((plan) => {
            const row = rowsByTree.get(plan.treeId);
            const name = nameOf(plan.treeId) ?? competencePlanCopy.areaUnavailable;
            const visual = areaVisualFor(nameOf(plan.treeId), plan.treeId);
            const tone = AREA_TONE_CLASSES[visual.tone];
            const progress = planProgress(plan.milestones);
            const fill = progressFillPercent(progress);
            const statusText = `${PLAN_CARD_STATUS_LABEL[planCardStatus(plan.milestones)]} · ${competencePlanCopy.progress(progress.completed, progress.total)}`;

            return (
              <div key={plan.treeId} className="contents">
                <div className="flex min-h-16 items-center gap-2 border-b border-border-subtle py-2 pr-3 text-sm font-medium text-text-primary">
                  <span aria-hidden="true" className={"flex size-8 shrink-0 items-center justify-center rounded-field " + tone.subtle}>
                    <Icon icon={visual.icon} size="inline" className={tone.text} />
                  </span>
                  <span className="truncate">{name}</span>
                </div>

                <div
                  className="relative min-h-16 border-b border-border-subtle py-2"
                  style={{ gridColumn: `2 / span ${span}` }}
                  data-testid={`timeline-row-${plan.treeId}`}
                >
                  {row?.bar ? (
                    <div className="flex flex-col gap-2 pb-12">
                      <span className="text-xs font-medium text-text-secondary">{statusText}</span>
                      {/* One positioned box per row: the track, the fill and the markers all share its coordinate space. */}
                      <div className="relative h-6">
                        <div
                          role="progressbar"
                          aria-label={`${competencePlanCopy.progressBarLabel}: ${name}`}
                          aria-valuemin={0}
                          aria-valuemax={progress.total}
                          aria-valuenow={progress.completed}
                          aria-valuetext={competencePlanCopy.progress(progress.completed, progress.total)}
                          className="absolute top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full bg-border-strong/40"
                          style={{ left: `${row.bar.startPct}%`, width: `${row.bar.widthPct}%` }}
                        >
                          <div
                            className={"h-full rounded-full motion-safe:transition-[width] motion-safe:duration-progress " + tone.fill}
                            style={{ width: `${fill}%` }}
                            data-testid={`timeline-fill-${plan.treeId}`}
                          />
                        </div>
                        {row.markers.map((marker) => {
                          const completed = marker.status === "completed";
                          return (
                            <span
                              key={marker.id}
                              role="img"
                              tabIndex={0}
                              aria-label={markerLabel(marker)}
                              data-testid="timeline-marker"
                              data-status={marker.status}
                              className="group absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                              style={{ left: `${marker.pct}%` }}
                            >
                              <span
                                className={
                                  "flex size-full items-center justify-center rounded-full " +
                                  (completed ? "bg-success-text text-surface" : "bg-surface ring-2 ring-inset ring-text-secondary")
                                }
                              >
                                {completed ? <Check aria-hidden="true" className="size-3" strokeWidth={3} /> : null}
                              </span>
                              <span
                                aria-hidden="true"
                                className={
                                  "pointer-events-none invisible absolute top-full z-10 mt-2 flex max-w-64 flex-col whitespace-normal rounded-field border border-border-subtle bg-surface px-2 py-1 text-xs text-text-primary shadow-card group-hover:visible group-focus-visible:visible " +
                                  tooltipAlignment(marker.pct)
                                }
                              >
                                <span className="font-medium">{marker.title}</span>
                                <span className="text-text-secondary">
                                  {formatPlanDate(marker.targetDate)} · {MILESTONE_STATUS_LABEL[marker.status]}
                                </span>
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="flex min-h-12 items-center text-xs text-text-secondary">{planOverviewCopy.noDatesInWindow}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 text-xs text-text-secondary">
        <span className="font-medium text-text-primary">{planOverviewCopy.legendHeading}</span>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="flex size-4 items-center justify-center rounded-full bg-success-text text-surface">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
            {planOverviewCopy.legendCompleted}
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-4 rounded-full bg-surface ring-2 ring-inset ring-text-secondary" />
            {planOverviewCopy.legendOpen}
          </li>
        </ul>
        <p>{planOverviewCopy.legendTrack}</p>
        <p>{planOverviewCopy.legendSpan}</p>
        <p>{planOverviewCopy.legendHover}</p>
      </div>
    </div>
  );
}
