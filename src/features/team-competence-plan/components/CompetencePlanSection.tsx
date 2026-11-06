"use client";

import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { Select } from "../../../components/ui/Select";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import { PRIORITY_LABEL, MILESTONE_STATUS_LABEL, competencePlanCopy } from "../copy";
import { planProgress } from "../domain/competence-plan";
import { useCompetencePlans } from "../client/use-competence-plans";
import type { ClientCompetenceArea, ClientCompetencePlan, CompetencePlanInput, CompetencePlanWriteResult } from "../client/competence-plan-gateway";
import { CompetencePlanEditor } from "./CompetencePlanEditor";
import { roadmapCopy } from "../../roadmap/copy";
import type { RoadmapItemView } from "../../roadmap/server/list-roadmap-items";

export interface CompetencePlanSectionProps {
  teamId: string;
}

/**
 * Team Kompetanseplan (TASK-006, BR-15–BR-17). Members see plans read-only; a lead can create, edit and archive plans.
 * Progress is the count of completed milestones only. No member assessment is read or shown.
 */
export function CompetencePlanSection({ teamId }: CompetencePlanSectionProps) {
  const { data, save, reload } = useCompetencePlans(teamId);
  const [openTree, setOpenTree] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [newTreeId, setNewTreeId] = useState("");

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

  const areaName = (treeId: string): string | null => data.areas.find((area) => area.treeId === treeId)?.name ?? null;
  const plannedTreeIds = new Set(data.plans.map((plan) => plan.treeId));
  const candidateAreas = data.areas.filter((area) => !plannedTreeIds.has(area.treeId));
  const visiblePlans = [...data.plans].sort((a, b) => (areaName(a.treeId) ?? "").localeCompare(areaName(b.treeId) ?? "", "nb"));

  async function handleSave(treeId: string, input: CompetencePlanInput): Promise<CompetencePlanWriteResult> {
    return save(treeId, input);
  }

  return (
    <section aria-labelledby="competence-plan-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="competence-plan-heading" className="text-lg font-semibold text-text-primary">
          {competencePlanCopy.heading}
        </h2>
        <p className="text-sm text-text-secondary">{competencePlanCopy.intro}</p>
        {data.canEdit ? null : <p className="text-sm text-text-secondary">{competencePlanCopy.readOnlyNotice}</p>}
      </div>

      {data.truncated ? <Alert variant="info">{competencePlanCopy.truncated}</Alert> : null}

      {visiblePlans.length === 0 ? (
        <EmptyState>
          <span className="block font-medium text-text-primary">{competencePlanCopy.emptyTitle}</span>
          {data.canEdit ? competencePlanCopy.emptyHint : null}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={competencePlanCopy.details}>
          {visiblePlans.map((plan) => {
            const name = areaName(plan.treeId);
            const expanded = openTree === plan.treeId;
            const isEditing = editing === plan.treeId;
            return (
              <li key={plan.treeId} className="rounded-field border border-border-subtle bg-surface p-4">
                {isEditing ? (
                  <CompetencePlanEditor
                    idPrefix={`plan-${plan.treeId}`}
                    areaName={name ?? plan.treeId}
                    initial={plan}
                    onSave={(input) => handleSave(plan.treeId, input)}
                    onCancel={() => setEditing(null)}
                    onSaved={() => setEditing(null)}
                  />
                ) : (
                  <PlanSummary
                    plan={plan}
                    areaName={name}
                    expanded={expanded}
                    canEdit={data.canEdit}
                    onToggle={() => setOpenTree(expanded ? null : plan.treeId)}
                    onEdit={() => setEditing(plan.treeId)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <LegacyItems items={data.legacyItems} failed={data.legacyFailed} />

      {data.canEdit ? (
        <NewPlan
          areas={candidateAreas}
          open={editing === "new"}
          treeId={newTreeId}
          onOpen={() => setEditing("new")}
          onSelect={setNewTreeId}
          onSave={(input) => handleSave(newTreeId, input)}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNewTreeId("");
          }}
        />
      ) : null}
    </section>
  );
}

function PlanSummary({
  plan,
  areaName,
  expanded,
  canEdit,
  onToggle,
  onEdit,
}: {
  plan: ClientCompetencePlan;
  areaName: string | null;
  expanded: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const progress = planProgress(plan.milestones);
  const percent = progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);
  const title = areaName ?? competencePlanCopy.areaUnavailable;
  const progressText = progress.total === 0 ? competencePlanCopy.progressNone : competencePlanCopy.progress(progress.completed, progress.total);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-text-primary">{title}</h3>
          <div className="flex flex-wrap gap-2">
            <Badge>{`${competencePlanCopy.priorityLabel}: ${PRIORITY_LABEL[plan.priority]}`}</Badge>
            <Badge>{`${competencePlanCopy.targetStageLabel}: ${SELF_ASSESSED_LEVEL_COPY[plan.targetStage].name}`}</Badge>
            {plan.archived ? <Badge>{competencePlanCopy.archivedNotice}</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="tertiary" size="sm" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? competencePlanCopy.hideDetails : competencePlanCopy.showDetails}
          </Button>
          {canEdit ? (
            <Button variant="secondary" size="sm" onClick={onEdit} aria-label={`${competencePlanCopy.edit}: ${title}`}>
              {competencePlanCopy.edit}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label={`${competencePlanCopy.progressBarLabel}: ${title}`}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.completed}
          aria-valuetext={progressText}
          className="h-2 flex-1 overflow-hidden rounded-full bg-surface-subtle"
        >
          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        <span className="whitespace-nowrap text-sm text-text-secondary">{progressText}</span>
      </div>

      {expanded ? (
        plan.milestones.length === 0 ? (
          <p className="text-sm text-text-secondary">{competencePlanCopy.milestonesEmpty}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {plan.milestones.map((milestone) => (
              <li key={milestone.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-text-primary">{milestone.title}</span>
                <span className="flex gap-2 text-text-secondary">
                  {milestone.targetDate ? <span>{milestone.targetDate}</span> : null}
                  <Badge>{MILESTONE_STATUS_LABEL[milestone.status]}</Badge>
                </span>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}

/** Existing roadmap competence-stage records (BR-17): read-only, shown as recorded. */
function LegacyItems({ items, failed }: { items: RoadmapItemView[]; failed: boolean }) {
  return (
    <section aria-labelledby="legacy-competence-heading" className="flex flex-col gap-2">
      <h3 id="legacy-competence-heading" className="text-base font-semibold text-text-primary">
        {competencePlanCopy.legacyHeading}
      </h3>
      <p className="text-sm text-text-secondary">{competencePlanCopy.legacyHint}</p>
      {failed ? (
        <Alert variant="error" role="alert">{competencePlanCopy.legacyFailed}</Alert>
      ) : items.length === 0 ? (
        <p className="text-sm text-text-secondary">{competencePlanCopy.legacyEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.treeId + item.targetNodeId} className="flex flex-wrap items-center justify-between gap-2 rounded-field border border-border-subtle p-3 text-sm">
              <span className="text-text-primary">{item.areaName ?? competencePlanCopy.areaUnavailable}</span>
              <span className="flex flex-wrap gap-2 text-text-secondary">
                {item.targetLabel ? <span>{item.targetLabel}</span> : null}
                <Badge>{roadmapCopy.status[item.status]}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewPlan({
  areas,
  open,
  treeId,
  onOpen,
  onSelect,
  onSave,
  onCancel,
  onSaved,
}: {
  areas: ClientCompetenceArea[];
  open: boolean;
  treeId: string;
  onOpen: () => void;
  onSelect: (treeId: string) => void;
  onSave: (input: CompetencePlanInput) => Promise<CompetencePlanWriteResult>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  if (areas.length === 0) {
    return <p className="text-sm text-text-secondary">{competencePlanCopy.noAreasAvailable}</p>;
  }
  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={onOpen}>
          {competencePlanCopy.newPlan}
        </Button>
      </div>
    );
  }
  const selected = areas.find((area) => area.treeId === treeId);
  return (
    <div className="flex flex-col gap-4 rounded-field border border-border-subtle bg-surface p-4">
      <h3 className="text-base font-semibold text-text-primary">{competencePlanCopy.newPlanHeading}</h3>
      <Select
        id="new-plan-area"
        label={competencePlanCopy.newPlanSelect}
        description={competencePlanCopy.newPlanSelectHint}
        value={treeId}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">—</option>
        {areas.map((area) => (
          <option key={area.treeId} value={area.treeId}>
            {area.name ?? competencePlanCopy.areaUnavailable}
          </option>
        ))}
      </Select>
      {selected ? (
        <CompetencePlanEditor
          key={selected.treeId}
          idPrefix={`new-${selected.treeId}`}
          areaName={selected.name ?? selected.treeId}
          initial={null}
          onSave={onSave}
          onCancel={onCancel}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}
