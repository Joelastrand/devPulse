"use client";

import { useState } from "react";
import { Check, Circle, FlaskConical, Layers, Monitor, Network, ShieldCheck, type LucideIcon } from "lucide-react";
import { Badge } from "../../../components/ui/Badge";
import { Card } from "../../../components/ui/Card";
import { Icon } from "../../../components/ui/Icon";
import { formatPlanDate, planCardStatus } from "../domain/plan-presentation";
import { buildPlanTimeline, nextPlanSteps, type MonthRef, type TimelineSpan } from "../domain/plan-timeline";
import { PLAN_CARD_STATUS_LABEL, PRIORITY_LABEL, MILESTONE_STATUS_LABEL, competencePlanCopy, planOverviewCopy } from "../copy";
import type { ClientCompetencePlan } from "../client/competence-plan-gateway";
import { planProgress } from "../domain/competence-plan";
import type { RoadmapPriority } from "../../roadmap/domain/roadmap-item";

const PRIORITY_RANK: Readonly<Record<RoadmapPriority, number>> = { high: 0, medium: 1, low: 2 };

const MONTH_FORMAT = new Intl.DateTimeFormat("nb-NO", { month: "short", year: "numeric", timeZone: "UTC" });

const AREA_ICONS: readonly LucideIcon[] = [FlaskConical, Monitor, Layers, Network, ShieldCheck];

/** Decorative area icon, chosen deterministically from the tree id. It carries no meaning, so the name stays the label. */
export function areaIconFor(treeId: string): LucideIcon {
  let sum = 0;
  for (const char of treeId) sum += char.charCodeAt(0);
  return AREA_ICONS[sum % AREA_ICONS.length] ?? Layers;
}

export function currentMonth(now: Date = new Date()): MonthRef {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export interface CompetencePlanOverviewProps {
  plans: readonly ClientCompetencePlan[];
  /** Area name for a tree id, or `null` when the area is not available. */
  nameOf: (treeId: string) => string | null;
  /** Injected for tests; defaults to the current UTC month. */
  start?: MonthRef;
}

/**
 * Overview of the team's plans (reference 20): a 3/6-month timeline of dated milestones, the next open steps and the
 * team's priorities. Only plan data is used. No member rating, skill average or invented metric is shown.
 */
export function CompetencePlanOverview({ plans, nameOf, start }: CompetencePlanOverviewProps) {
  const [span, setSpan] = useState<TimelineSpan>(6);
  const [fallbackStart] = useState<MonthRef>(() => currentMonth());
  const windowStart = start ?? fallbackStart;
  const active = plans.filter((plan) => !plan.archived);
  const timeline = buildPlanTimeline(active, windowStart, span);
  const timelineRows = active.map((plan) => ({ plan, row: timeline.rows.find((row) => row.treeId === plan.treeId) }));
  const hasAnyBar = timeline.rows.some((row) => row.bar !== null);
  const steps = nextPlanSteps(active, 4);
  // Goals are the plans' own milestones, checked when completed. Capped to keep the card short.
  const goals = active
    .flatMap((plan) => plan.milestones.map((milestone) => ({ key: `${plan.treeId}-${milestone.id}`, title: milestone.title, done: milestone.status === "completed" })))
    .slice(0, 6);
  const needs = [...active].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card as="section" variant="bordered" padding="md" aria-labelledby="plan-timeline-heading" className="flex min-w-0 flex-col gap-4 self-start">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 id="plan-timeline-heading" className="text-base font-semibold text-text-primary">
              {planOverviewCopy.timelineHeading}
            </h3>
            <p className="text-sm text-text-secondary">{planOverviewCopy.timelineHint}</p>
          </div>
          <div role="group" aria-label={planOverviewCopy.spanGroup} className="inline-flex rounded-field border border-border-subtle p-0.5">
            {([3, 6] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={span === value}
                onClick={() => setSpan(value)}
                className={
                  "min-h-9 rounded-field px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
                  (span === value ? "bg-primary text-primary-text" : "text-text-secondary hover:text-text-primary")
                }
              >
                {planOverviewCopy.span(value)}
              </button>
            ))}
          </div>
        </div>

        {timeline.rows.length === 0 ? null : (
          <>
            <p className="text-sm text-text-secondary lg:hidden">{planOverviewCopy.mobileNotice}</p>
            <div className="hidden min-w-0 lg:block">
              <div className="grid" style={{ gridTemplateColumns: `minmax(9rem,13rem) repeat(${span}, minmax(0,1fr))` }}>
                <div className="border-b border-border-subtle py-2 text-sm font-medium text-text-secondary">
                  {planOverviewCopy.areaColumn}
                </div>
                {timeline.months.map((month) => (
                  <div
                    key={`${month.year}-${month.month}`}
                    className="border-b border-l border-border-subtle py-2 pl-2 text-sm text-text-secondary"
                  >
                    {MONTH_FORMAT.format(new Date(Date.UTC(month.year, month.month - 1, 1)))}
                  </div>
                ))}
                {timelineRows.map(({ plan, row }) => {
                  const name = nameOf(plan.treeId) ?? competencePlanCopy.areaUnavailable;
                  const progress = planProgress(plan.milestones);
                  const label = `${PLAN_CARD_STATUS_LABEL[planCardStatus(plan.milestones)]} (${competencePlanCopy.progress(progress.completed, progress.total)})`;
                  return (
                    <div key={plan.treeId} className="contents">
                      <div className="flex min-h-14 items-center border-b border-border-subtle py-2 pr-3 text-sm font-medium text-text-primary">
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon icon={areaIconFor(plan.treeId)} size="inline" className="shrink-0 text-primary" />
                          <span className="truncate">{name}</span>
                        </span>
                      </div>
                      <div
                        className="relative border-b border-border-subtle"
                        style={{ gridColumn: `2 / span ${span}` }}
                        data-testid={`timeline-row-${plan.treeId}`}
                      >
                        {row?.bar ? (
                          <div
                            className="absolute top-1/2 flex h-7 -translate-y-1/2 items-center overflow-hidden rounded-full bg-primary px-3 text-xs font-medium whitespace-nowrap text-primary-text"
                            style={{ left: `${row.bar.startPct}%`, width: `${row.bar.widthPct}%` }}
                          >
                            <span className="truncate">{label}</span>
                          </div>
                        ) : (
                          <p className="flex min-h-14 items-center px-2 text-xs text-text-secondary">{planOverviewCopy.noDatesInWindow}</p>
                        )}
                        {row?.markers.map((marker) => (
                          <span
                            key={marker.id}
                            aria-hidden="true"
                            className={
                              "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface " +
                              (marker.status === "completed" ? "bg-success-text" : "bg-text-secondary")
                            }
                            style={{ left: `${marker.pct}%` }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {hasAnyBar ? null : <p className="text-sm text-text-secondary">{planOverviewCopy.timelineEmpty}</p>}
      </Card>

      <div className="flex flex-col gap-5">
        <Card as="section" variant="bordered" padding="md" aria-labelledby="plan-goals-heading" className="flex flex-col gap-3">
          <h3 id="plan-goals-heading" className="text-base font-semibold text-text-primary">
            {planOverviewCopy.goalsHeading}
          </h3>
          <p className="text-sm text-text-secondary">{planOverviewCopy.goalsHint}</p>
          {goals.length === 0 ? (
            <p className="text-sm text-text-secondary">{planOverviewCopy.goalsEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {goals.map((goal) => (
                <li key={goal.key} className="flex items-start gap-3 text-sm">
                  <Icon icon={goal.done ? Check : Circle} size="inline" className={goal.done ? "mt-0.5 text-success-text" : "mt-0.5 text-text-secondary"} />
                  <span className={goal.done ? "text-text-secondary line-through" : "text-text-primary"}>{goal.title}</span>
                  <span className="sr-only">{goal.done ? planOverviewCopy.goalDone : planOverviewCopy.goalOpen}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card as="section" variant="bordered" padding="md" aria-labelledby="plan-next-steps-heading" className="flex flex-col gap-3">
          <h3 id="plan-next-steps-heading" className="text-base font-semibold text-text-primary">
            {planOverviewCopy.nextStepsHeading}
          </h3>
          {steps.length === 0 ? (
            <p className="text-sm text-text-secondary">{planOverviewCopy.nextStepsEmpty}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {steps.map((step) => (
                <li key={`${step.treeId}-${step.milestone.id}`} className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-text-primary">{step.milestone.title}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <span>{nameOf(step.treeId) ?? competencePlanCopy.areaUnavailable}</span>
                    {formatPlanDate(step.milestone.targetDate) ? <span>· {formatPlanDate(step.milestone.targetDate)}</span> : null}
                    <Badge>{MILESTONE_STATUS_LABEL[step.milestone.status]}</Badge>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card as="section" variant="bordered" padding="md" aria-labelledby="plan-needs-heading" className="flex flex-col gap-3">
          <h3 id="plan-needs-heading" className="text-base font-semibold text-text-primary">
            {planOverviewCopy.needsHeading}
          </h3>
          <p className="text-sm text-text-secondary">{planOverviewCopy.needsHint}</p>
          {needs.length === 0 ? (
            <p className="text-sm text-text-secondary">{planOverviewCopy.needsEmpty}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {needs.map((plan, index) => (
                <li key={plan.treeId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-xs font-semibold text-text-primary">
                      {index + 1}
                    </span>
                    <span className="truncate text-text-primary">{nameOf(plan.treeId) ?? competencePlanCopy.areaUnavailable}</span>
                  </span>
                  <Badge>{PRIORITY_LABEL[plan.priority]}</Badge>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
