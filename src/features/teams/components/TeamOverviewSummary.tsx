import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Card } from "../../../components/ui/Card";
import { LoadingState } from "../../../components/ui/LoadingState";
import { roadmapCopy } from "../../roadmap/copy";
import { formatPlanDate } from "../../roadmap/components/RoadmapPlanSummary";
import type { PlanSummaryState } from "../../roadmap/components/RoadmapPlanning";
import { compareRoadmapPlans } from "../../roadmap/domain/roadmap-sort";
import type { RoadmapItemView } from "../../roadmap/server/list-roadmap-items";

/**
 * Team overview summary row and roadmap next-steps panel
 * (docs/features/visual-fidelity-and-ui-fixes TASK-028, reference 05 top half).
 *
 * Every value is derived from data the overview already loads: the challenges
 * read and the single roadmap read of
 * `RoadmapPlanningScope`. No read is added here. The reference's pulse
 * visualisation, coverage card, header counts and last-updated value are
 * omitted (D-12): none of them can be derived from an existing read without
 * inventing a value. Each card has its own state; a failed read never blanks
 * the other cards (BR-26).
 */
export const TEAM_OVERVIEW_SUMMARY_COPY = {
  challengesHeading: "Åpne utfordringer",
  challengesUnavailable: "Utfordringene kunne ikke lastes.",
  openChallenges: "Utfordringer med status åpen",
  plansHeading: "Pågående planer",
  plansUnavailable: "Planer kunne ikke lastes.",
  activePlans: "Planer som pågår",
  nextStepsHeading: "Roadmap – neste steg",
  noPlans: "Ingen planer ennå.",
  nextStepsUnavailable: "Roadmap-neste steg kunne ikke lastes.",
  unnamedArea: roadmapCopy.untracked.unnamedArea,
  goToRoadmap: "Gå til roadmap",
} as const;

const NEXT_STEPS_LIMIT = 4;

export interface TeamOverviewSummaryProps {
  teamId: string;
  /** Count of open challenges from the loaded challenges read; `null` when that read is unavailable. */
  openChallenges: number | null;
  plans: PlanSummaryState;
}

export function TeamOverviewSummary({ teamId, openChallenges, plans }: TeamOverviewSummaryProps) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-stretch">
      <div className="grid gap-4 sm:grid-cols-2">
        <SummaryCard heading={TEAM_OVERVIEW_SUMMARY_COPY.challengesHeading}>
          {openChallenges === null ? (
            <p className="text-sm text-text-secondary">{TEAM_OVERVIEW_SUMMARY_COPY.challengesUnavailable}</p>
          ) : (
            <CountValue value={openChallenges} label={TEAM_OVERVIEW_SUMMARY_COPY.openChallenges} />
          )}
        </SummaryCard>
        <SummaryCard heading={TEAM_OVERVIEW_SUMMARY_COPY.plansHeading}>
          <ActivePlansValue plans={plans} />
        </SummaryCard>
      </div>
      <NextStepsPanel teamId={teamId} plans={plans} />
    </div>
  );
}

function SummaryCard({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Card as="section" variant="bordered" padding="md" className="flex flex-col gap-3" aria-label={heading}>
      <h2 className="text-sm font-semibold text-text-primary">{heading}</h2>
      {children}
    </Card>
  );
}

function CountValue({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-metric font-semibold tabular-nums text-text-primary">{value}</p>
      <p className="text-help text-text-secondary">{label}</p>
    </div>
  );
}

function ActivePlansValue({ plans }: { plans: PlanSummaryState }) {
  if (plans.phase === "loading") return <LoadingState label={roadmapCopy.loading} />;
  if (plans.phase === "error") {
    return <p className="text-sm text-text-secondary">{TEAM_OVERVIEW_SUMMARY_COPY.plansUnavailable}</p>;
  }
  const active = plans.items.filter((item) => item.status === "active").length;
  return <CountValue value={active} label={TEAM_OVERVIEW_SUMMARY_COPY.activePlans} />;
}

function NextStepsPanel({ teamId, plans }: { teamId: string; plans: PlanSummaryState }) {
  return (
    <Card as="section" variant="bordered" padding="md" className="flex flex-col gap-4" aria-labelledby="team-next-steps-heading">
      <h2 id="team-next-steps-heading" className="text-sm font-semibold text-text-primary">
        {TEAM_OVERVIEW_SUMMARY_COPY.nextStepsHeading}
      </h2>
      <NextStepsBody plans={plans} />
      <Link
        href={`/teams/${encodeURIComponent(teamId)}/roadmap`}
        className="mt-auto w-fit text-sm font-medium text-text-primary underline"
      >
        {TEAM_OVERVIEW_SUMMARY_COPY.goToRoadmap}
        <span aria-hidden="true"> →</span>
      </Link>
    </Card>
  );
}

function NextStepsBody({ plans }: { plans: PlanSummaryState }) {
  if (plans.phase === "loading") return <LoadingState label={roadmapCopy.loading} />;
  if (plans.phase === "error") {
    return <Alert variant="error" className="text-sm">{TEAM_OVERVIEW_SUMMARY_COPY.nextStepsUnavailable}</Alert>;
  }
  const steps = plans.items.filter((item) => !item.archived).sort(compareRoadmapPlans).slice(0, NEXT_STEPS_LIMIT);
  if (steps.length === 0) {
    return <p className="text-sm text-text-secondary">{TEAM_OVERVIEW_SUMMARY_COPY.noPlans}</p>;
  }
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((item) => (
        <NextStepItem key={item.treeId} item={item} />
      ))}
    </ol>
  );
}

function NextStepItem({ item }: { item: RoadmapItemView }) {
  return (
    <li className="flex flex-col gap-0.5 border-l-2 border-border-subtle pl-3">
      <span className="break-words text-sm font-medium text-text-primary">
        {item.areaName ?? TEAM_OVERVIEW_SUMMARY_COPY.unnamedArea}
      </span>
      <span className="text-help text-text-secondary">
        {roadmapCopy.status[item.status]}
        {item.targetDate !== null ? ` · ${formatPlanDate(item.targetDate)}` : ""}
      </span>
    </li>
  );
}
