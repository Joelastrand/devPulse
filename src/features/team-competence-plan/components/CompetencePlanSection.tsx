"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Alert } from "../../../components/ui/Alert";
import { Badge } from "../../../components/ui/Badge";
import { Icon } from "../../../components/ui/Icon";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import { PLAN_CARD_STATUS_LABEL, PRIORITY_LABEL, competencePlanCopy } from "../copy";
import { planProgress, type PlanMilestone } from "../domain/competence-plan";
import { planCardStatus } from "../domain/plan-presentation";
import { useCompetencePlans } from "../client/use-competence-plans";
import type { ClientCompetencePlan, CompetencePlanInput, CompetencePlanWriteResult } from "../client/competence-plan-gateway";
import { CompetencePlanEditor } from "./CompetencePlanEditor";
import { CompetencePlanOverview } from "./CompetencePlanOverview";
import { PlanMilestoneChecklist } from "./PlanMilestoneChecklist";
import { AREA_TONE_CLASSES, areaVisualFor } from "../domain/area-visual";

export interface CompetencePlanSectionProps {
  teamId: string;
}

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/**
 * Team Kompetanseplan (TASK-006, BR-15–BR-17). Shows development plans and their steps. Members see everything
 * read-only; a lead can create, edit and archive plans and complete or reopen steps. A plan needs no competence area.
 * Progress is the count of completed steps only. No member assessment is read or shown. Team competence needs and
 * coverage live on Teamkompetanse, and roadmap competence steps are managed in Roadmap; both are linked, not repeated here.
 */
export function CompetencePlanSection({ teamId }: CompetencePlanSectionProps) {
  const { data, create, save, saveMilestoneCompletion, reload } = useCompetencePlans(teamId);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  // `"new"` opens the creation form; a plan id opens that plan's editor.
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [today] = useState<string>(todayUtc);
  // One milestone save at a time, page-wide. The ref closes the window before React re-renders with the pending state.
  const [pending, setPending] = useState<{ planId: string; milestoneId: string } | null>(null);
  const [saveResult, setSaveResult] = useState<{ planId: string; outcome: "saved" | "failed" } | null>(null);
  const inFlight = useRef(false);

  if (data.phase === "loading") {
    return <LoadingState label={competencePlanCopy.loading} />;
  }
  if (data.phase === "error") {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="error" role="alert">
          {data.reason === "forbidden" ? competencePlanCopy.forbidden : competencePlanCopy.loadError}
        </Alert>
        {data.reason === "forbidden" ? null : (
          <div>
            <Button variant="secondary" size="sm" onClick={reload}>
              {competencePlanCopy.retry}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const titleOf = (planId: string): string | null => data.plans.find((plan) => plan.planId === planId)?.title ?? null;
  const visiblePlans = [...data.plans].sort((a, b) => a.title.localeCompare(b.title, "nb"));
  const base = `/teams/${encodeURIComponent(teamId)}`;

  async function toggleMilestone(planId: string, milestone: PlanMilestone) {
    if (inFlight.current || data.phase !== "loaded") return;
    inFlight.current = true;
    setPending({ planId, milestoneId: milestone.id });
    setSaveResult(null);
    const outcome = await saveMilestoneCompletion(planId, milestone.id, milestone.status !== "completed");
    inFlight.current = false;
    setPending(null);
    // The card and the overview both derive from the saved plan, so they update only on a confirmed write.
    setSaveResult({ planId, outcome: outcome.status === "ok" ? "saved" : "failed" });
  }

  function openPlan(planId: string) {
    setOpenPlanId(planId);
    const card = document.getElementById(`plan-card-${planId}`);
    card?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }

  return (
    <section aria-labelledby="competence-plan-heading" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h2 id="competence-plan-heading" className="text-lg font-semibold text-text-primary">
          {competencePlanCopy.heading}
        </h2>
        <p className="text-sm text-text-secondary">{competencePlanCopy.intro}</p>
        {data.canEdit ? null : <p className="text-sm text-text-secondary">{competencePlanCopy.readOnlyNotice}</p>}
        <nav aria-label={competencePlanCopy.heading} className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span className="text-text-secondary">{competencePlanCopy.teamkompetanseLinkHint}</span>
          <Link href={`${base}/competence`} className="font-medium text-primary underline underline-offset-2 hover:text-text-primary">
            {competencePlanCopy.teamkompetanseLink}
          </Link>
          <Link href={`${base}/roadmap`} className="font-medium text-primary underline underline-offset-2 hover:text-text-primary">
            {competencePlanCopy.roadmapLink}
          </Link>
        </nav>
      </div>

      {data.truncated ? <Alert variant="info">{competencePlanCopy.truncated}</Alert> : null}

      {data.plans.length > 0 ? <CompetencePlanOverview plans={data.plans} nameOf={titleOf} today={today} onOpenPlan={openPlan} /> : null}

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-text-primary">{competencePlanCopy.details}</h3>
        {visiblePlans.length === 0 ? (
          <EmptyState>
            <span className="block font-medium text-text-primary">{competencePlanCopy.emptyTitle}</span>
            {data.canEdit ? competencePlanCopy.emptyHint : null}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={competencePlanCopy.details}>
            {visiblePlans.map((plan) => {
              const expanded = openPlanId === plan.planId;
              const isEditing = editing === plan.planId;
              const planPending = pending?.planId === plan.planId ? pending.milestoneId : null;
              return (
                <li key={plan.planId} id={`plan-card-${plan.planId}`} className="scroll-mt-6 rounded-surface border border-border-subtle bg-surface p-4">
                  {isEditing ? (
                    <CompetencePlanEditor
                      idPrefix={`plan-${plan.planId}`}
                      initial={plan}
                      onSave={(input) => save(plan.planId, input)}
                      onCancel={() => setEditing(null)}
                      onSaved={() => setEditing(null)}
                    />
                  ) : (
                    <PlanCard
                      plan={plan}
                      today={today}
                      expanded={expanded}
                      canEdit={data.canEdit}
                      onToggle={() => setOpenPlanId(expanded ? null : plan.planId)}
                      onEdit={() => setEditing(plan.planId)}
                      checklist={{
                        pendingMilestoneId: planPending,
                        busy: pending !== null,
                        saveFailed: saveResult?.planId === plan.planId && saveResult.outcome === "failed",
                        onToggle: (milestone) => void toggleMilestone(plan.planId, milestone),
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {saveResult?.outcome === "saved" ? (
          <p role="status" className="text-sm text-text-secondary">
            {competencePlanCopy.milestoneSaved}
          </p>
        ) : null}
      </div>

      {data.canEdit ? (
        <NewPlan
          open={editing === "new"}
          onOpen={() => setEditing("new")}
          onSave={(input) => create(input)}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

interface PlanChecklistProps {
  pendingMilestoneId: string | null;
  busy: boolean;
  saveFailed: boolean;
  onToggle: (milestone: PlanMilestone) => void;
}

/** One competence plan's card: its title, status and progress, and (expanded) the milestone checklist. */
function PlanCard({
  plan,
  today,
  expanded,
  canEdit,
  onToggle,
  onEdit,
  checklist,
}: {
  plan: ClientCompetencePlan;
  today: string;
  expanded: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onEdit: () => void;
  checklist: PlanChecklistProps;
}) {
  const progress = planProgress(plan.milestones);
  const percent = progress.total === 0 ? 0 : (progress.completed / progress.total) * 100;
  const title = plan.title;
  const visual = areaVisualFor(title, plan.planId);
  const tone = AREA_TONE_CLASSES[visual.tone];
  const progressText = progress.total === 0 ? competencePlanCopy.progressNone : competencePlanCopy.progress(progress.completed, progress.total);
  const controlsId = `plan-milestones-${plan.planId}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className={"flex size-9 shrink-0 items-center justify-center rounded-field " + tone.subtle}>
          <Icon icon={visual.icon} size="inline" className={tone.text} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-text-primary">{title}</h3>
            <Badge>{PLAN_CARD_STATUS_LABEL[planCardStatus(plan.milestones)]}</Badge>
            <Badge>{`${competencePlanCopy.priorityLabel}: ${PRIORITY_LABEL[plan.priority]}`}</Badge>
            {plan.archived ? <Badge>{competencePlanCopy.archivedNotice}</Badge> : null}
          </div>
          <p className="text-sm text-text-secondary">{competencePlanCopy.goalDescription(SELF_ASSESSED_LEVEL_COPY[plan.targetStage].name)}</p>
        </div>
        {canEdit ? (
          <Button variant="secondary" size="sm" onClick={onEdit} aria-label={`${competencePlanCopy.edit}: ${title}`} className="shrink-0">
            {competencePlanCopy.edit}
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label={`${competencePlanCopy.progressBarLabel}: ${title}`}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.completed}
          aria-valuetext={progressText}
          className="h-2 flex-1 overflow-hidden rounded-full bg-border-strong/40"
        >
          <div className={"h-full rounded-full motion-safe:transition-[width] motion-safe:duration-progress " + tone.fill} style={{ width: `${percent}%` }} />
        </div>
        <span className="whitespace-nowrap text-sm text-text-secondary">{progressText}</span>
        <Button
          variant="tertiary"
          size="sm"
          aria-expanded={expanded}
          aria-controls={controlsId}
          aria-label={`${expanded ? competencePlanCopy.hideDetails : competencePlanCopy.showDetails}: ${title}`}
          onClick={onToggle}
          className="shrink-0"
        >
          <Icon icon={ChevronDown} size="inline" className={"transition-transform motion-reduce:transition-none " + (expanded ? "rotate-180" : "")} />
          <span aria-hidden="true" className="hidden sm:inline">{expanded ? competencePlanCopy.hideDetails : competencePlanCopy.showDetails}</span>
        </Button>
      </div>

      {expanded ? (
        <div id={controlsId}>
          <PlanMilestoneChecklist
            areaName={title}
            milestones={plan.milestones}
            today={today}
            canEdit={canEdit}
            pendingMilestoneId={checklist.pendingMilestoneId}
            busy={checklist.busy}
            saveFailed={checklist.saveFailed}
            onToggle={checklist.onToggle}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The single plan-creation entry point. It needs no competence area: the lead names the plan and fills its content. */
function NewPlan({
  open,
  onOpen,
  onSave,
  onCancel,
  onSaved,
}: {
  open: boolean;
  onOpen: () => void;
  onSave: (input: CompetencePlanInput) => Promise<CompetencePlanWriteResult>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={onOpen}>
          {competencePlanCopy.newPlan}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 rounded-field border border-border-subtle bg-surface p-4">
      <h3 className="text-base font-semibold text-text-primary">{competencePlanCopy.newPlanHeading}</h3>
      <CompetencePlanEditor idPrefix="new-plan" initial={null} onSave={onSave} onCancel={onCancel} onSaved={onSaved} />
    </div>
  );
}
