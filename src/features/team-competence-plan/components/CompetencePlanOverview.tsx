"use client";

import { useState } from "react";
import { CircleCheck, CircleDashed, ListChecks, Target, type LucideIcon } from "lucide-react";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Icon } from "../../../components/ui/Icon";
import { formatPlanDate, isMilestoneOverdue, planSummaryMetrics } from "../domain/plan-presentation";
import { buildPlanTimeline, nextPlanSteps, type MonthRef, type TimelineSpan } from "../domain/plan-timeline";
import { MILESTONE_STATUS_LABEL, competencePlanCopy, planOverviewCopy } from "../copy";
import type { ClientCompetencePlan } from "../client/competence-plan-gateway";
import { AREA_TONE_CLASSES, areaVisualFor } from "../domain/area-visual";
import { PlanTimeline } from "./PlanTimeline";

const todayUtc = (now: Date): string => now.toISOString().slice(0, 10);

export function currentMonth(now: Date = new Date()): MonthRef {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export interface CompetencePlanOverviewProps {
  plans: readonly ClientCompetencePlan[];
  /** Area name for a tree id, or `null` when the area is not available. */
  nameOf: (treeId: string) => string | null;
  /** Injected for tests; defaults to the current UTC month. */
  start?: MonthRef;
  /** Injected for tests; an ISO day (`YYYY-MM-DD`). Defaults to today (UTC). */
  today?: string;
  /** Scrolls to and expands a plan's card in "Detaljer og tiltak". */
  onOpenPlan: (treeId: string) => void;
}

/**
 * Overview of the team's plans (reference 20): a 3/6-month timeline on the left, and on the right a compact progress
 * summary and the next open steps. The milestone checklist itself lives in each plan's card, not here, so no step is
 * repeated. Only plan data is used; no member rating or invented metric is shown.
 */
export function CompetencePlanOverview({ plans, nameOf, start, today, onOpenPlan }: CompetencePlanOverviewProps) {
  const [span, setSpan] = useState<TimelineSpan>(6);
  const [fallbackStart] = useState<MonthRef>(() => currentMonth());
  const [fallbackToday] = useState<string>(() => todayUtc(new Date()));
  const windowStart = start ?? fallbackStart;
  const todayIso = today ?? fallbackToday;
  const active = plans.filter((plan) => !plan.archived);
  const timeline = buildPlanTimeline(active, windowStart, span);
  const hasAnyBar = timeline.rows.some((row) => row.bar !== null);
  const steps = nextPlanSteps(active, 4);
  const metrics = planSummaryMetrics(active);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(16rem,3fr)]">
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

        {active.length === 0 ? null : <PlanTimeline plans={active} nameOf={nameOf} model={timeline} span={span} />}
        {hasAnyBar ? null : <p className="text-sm text-text-secondary">{planOverviewCopy.timelineEmpty}</p>}
      </Card>

      <div className="flex flex-col gap-5">
        <Card as="section" variant="bordered" padding="md" aria-labelledby="plan-goals-heading" className="flex flex-col gap-4">
          <h3 id="plan-goals-heading" className="text-base font-semibold text-text-primary">
            {planOverviewCopy.goalsHeading}
          </h3>
          {metrics.activePlans === 0 ? (
            <p className="text-sm text-text-secondary">{planOverviewCopy.goalsEmpty}</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <Metric icon={ListChecks} tone="info" label={planOverviewCopy.metricPlans} value={String(metrics.activePlans)} />
                <Metric icon={CircleCheck} tone="success" label={planOverviewCopy.metricCompleted} value={String(metrics.completedSteps)} />
                <Metric icon={CircleDashed} tone="warning" label={planOverviewCopy.metricRemaining} value={String(metrics.remainingSteps)} />
                <Metric icon={Target} tone="info" label={planOverviewCopy.metricPercent} value={metrics.percent === null ? "–" : `${metrics.percent} %`} />
              </dl>
              <div
                role="progressbar"
                aria-label={planOverviewCopy.metricPercent}
                aria-valuemin={0}
                aria-valuemax={metrics.totalSteps}
                aria-valuenow={metrics.completedSteps}
                aria-valuetext={metrics.percent === null ? planOverviewCopy.metricNoSteps : `${metrics.percent} %`}
                className="h-2 overflow-hidden rounded-full bg-border-strong/40"
              >
                <div className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-progress" style={{ width: `${metrics.percent ?? 0}%` }} />
              </div>
            </>
          )}
        </Card>

        <Card as="section" variant="bordered" padding="md" aria-labelledby="plan-next-steps-heading" className="flex flex-col gap-3">
          <h3 id="plan-next-steps-heading" className="text-base font-semibold text-text-primary">
            {planOverviewCopy.nextStepsHeading}
          </h3>
          {steps.length === 0 ? (
            <p className="text-sm text-text-secondary">{planOverviewCopy.nextStepsEmpty}</p>
          ) : (
            <>
              <p className="text-xs text-text-secondary">{planOverviewCopy.nextStepsHint}</p>
              <ul className="flex flex-col divide-y divide-border-subtle">
                {steps.map((step) => {
                  const areaName = nameOf(step.treeId) ?? competencePlanCopy.areaUnavailable;
                  const visual = areaVisualFor(nameOf(step.treeId), step.treeId);
                  const tone = AREA_TONE_CLASSES[visual.tone];
                  const overdue = isMilestoneOverdue(step.milestone, todayIso);
                  const date = formatPlanDate(step.milestone.targetDate);
                  return (
                    <li key={`${step.treeId}-${step.milestone.id}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <span aria-hidden="true" className={"flex size-8 shrink-0 items-center justify-center rounded-field " + tone.subtle}>
                        <Icon icon={visual.icon} size="inline" className={tone.text} />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-sm font-medium text-text-primary">{step.milestone.title}</span>
                        <span className="text-xs text-text-secondary">
                          {areaName} · {date ?? competencePlanCopy.milestoneNoDate}
                        </span>
                        <span className="flex flex-wrap gap-1">
                          <Badge>{overdue ? planOverviewCopy.overdue : MILESTONE_STATUS_LABEL[step.milestone.status]}</Badge>
                        </span>
                      </div>
                      <Button
                        variant="tertiary"
                        size="sm"
                        className="shrink-0"
                        aria-label={planOverviewCopy.openPlanFor(areaName, step.milestone.title)}
                        onClick={() => onOpenPlan(step.treeId)}
                      >
                        {planOverviewCopy.openPlan}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

const METRIC_TONE: Record<"info" | "success" | "warning", { text: string; subtle: string }> = {
  info: { text: "text-info-text", subtle: "bg-info-subtle" },
  success: { text: "text-success-text", subtle: "bg-success-subtle" },
  warning: { text: "text-warning-text", subtle: "bg-warning-subtle" },
};

function Metric({ icon, tone, label, value }: { icon: LucideIcon; tone: keyof typeof METRIC_TONE; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-field border border-border-subtle p-3">
      <span className={"flex size-8 items-center justify-center rounded-field " + METRIC_TONE[tone].subtle}>
        <Icon icon={icon} size="inline" className={METRIC_TONE[tone].text} />
      </span>
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="text-xl font-semibold text-text-primary">{value}</dd>
    </div>
  );
}

