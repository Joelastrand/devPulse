import Link from "next/link";
import type { ReactNode } from "react";
import { Check, CircleDashed, Minus, TriangleAlert, type LucideIcon } from "lucide-react";
import { AREA_TONE_CLASSES, areaVisualFor } from "../../team-competence-plan/domain/area-visual";
import { Icon } from "../../../components/ui/Icon";
import { AREA_STATUSES, countStatuses, type AreaStatus } from "../domain/area-status";
import { priorityGroups, statusOf, type OverviewArea, type OverviewLevelState } from "../domain/overview-areas";
import { OVERVIEW_COPY } from "../overview-copy";

export type { OverviewArea } from "../domain/overview-areas";

export interface TeamCompetenceOverviewProps {
  readonly teamId: string;
  /** One collection for every figure on this page: radar summary, donut, key figures, list and priorities. */
  readonly areas: readonly OverviewArea[];
  /** Teamadmins see the plan-creation actions; members see plan status only. Server checks stay authoritative. */
  readonly canEdit: boolean;
  /** Automatic mode: the per-area level is shown in the radar above, so the table does not repeat it. */
  readonly mode: "collaborative" | "automatic";
  /** The radar (or the automatic panel) for the left-hand profile card. */
  readonly radar: ReactNode;
}

const STATUS_ICON: Record<AreaStatus, LucideIcon> = {
  meets: Check,
  near: Minus,
  under: TriangleAlert,
  unrated: CircleDashed,
};

const STATUS_BADGE_CLASS: Record<AreaStatus, string> = {
  meets: "bg-success-subtle text-success-text",
  near: "bg-info-subtle text-info-text",
  under: "bg-warning-subtle text-warning-text",
  unrated: "bg-surface-subtle text-text-secondary",
};

/** Series colour per status. Colour is never the only signal: each status also has a text label and a count. */
const STATUS_SERIES_COLOR: Record<AreaStatus, string> = {
  meets: "var(--success-text)",
  near: "var(--chart-1)",
  under: "var(--warning-text)",
  unrated: "var(--border-strong)",
};

const CARD = "flex min-w-0 flex-col gap-4 rounded-surface border border-border-subtle bg-surface p-6 shadow-card";
const LINK = "text-sm font-medium text-primary underline underline-offset-2 hover:text-text-primary";
const RING_RADIUS = 48;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface DonutArc {
  readonly status: AreaStatus;
  readonly length: number;
  readonly offset: number;
}

/** Arc lengths and offsets, computed without mutation so the render stays pure. Zero-count statuses have no arc. */
function donutArcs(counts: Record<AreaStatus, number>, total: number): DonutArc[] {
  if (total === 0) return [];
  return AREA_STATUSES.filter((status) => counts[status] > 0).reduce<DonutArc[]>((arcs, status) => {
    const previous = arcs[arcs.length - 1];
    const offset = previous ? previous.offset + previous.length : 0;
    return [...arcs, { status, length: (counts[status] / total) * RING_CIRCUMFERENCE, offset }];
  }, []);
}

function Donut({ counts, total }: { readonly counts: Record<AreaStatus, number>; total: number }) {
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={`${total} ${OVERVIEW_COPY.donutCenterLabel}`} className="size-36 shrink-0 -rotate-90">
      <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="var(--surface-subtle)" strokeWidth="14" />
      {donutArcs(counts, total).map((arc) => (
        <circle
          key={arc.status}
          cx="60"
          cy="60"
          r={RING_RADIUS}
          fill="none"
          stroke={STATUS_SERIES_COLOR[arc.status]}
          strokeWidth="14"
          strokeDasharray={`${arc.length} ${RING_CIRCUMFERENCE - arc.length}`}
          strokeDashoffset={-arc.offset}
        />
      ))}
    </svg>
  );
}

function PlanAction({ treeId, hasPlan, canEdit, teamId, name }: { readonly treeId: string; readonly hasPlan: boolean; readonly canEdit: boolean; readonly teamId: string; readonly name: string }) {
  const base = `/teams/${encodeURIComponent(teamId)}`;
  const sr = <span className="sr-only"> {OVERVIEW_COPY.srOnlyFor(name)}</span>;
  if (hasPlan) {
    return (
      <Link href={`${base}/competence-plan#plan-card-${treeId}`} className={LINK}>
        {canEdit ? OVERVIEW_COPY.editPlan : OVERVIEW_COPY.viewPlan}
        {sr}
      </Link>
    );
  }
  if (canEdit) {
    return (
      <Link href={`${base}/competence-plan?area=${encodeURIComponent(treeId)}`} className={LINK}>
        {OVERVIEW_COPY.createPlan}
        {sr}
      </Link>
    );
  }
  return <span className="text-sm text-text-secondary">{OVERVIEW_COPY.noPlan}</span>;
}

const LEVEL_STATE_LABEL: Record<Exclude<OverviewLevelState, "value">, string> = {
  not_set: OVERVIEW_COPY.levelNotSet,
  insufficient_data: OVERVIEW_COPY.levelInsufficient,
  unavailable: OVERVIEW_COPY.levelUnavailable,
};

function LevelBar({ level, levelState, label }: { readonly level: number | null; readonly levelState: OverviewLevelState; readonly label: string }) {
  if (levelState !== "value" || level === null) {
    // Withheld or unset values are labelled, never drawn as an empty bar that reads as zero.
    return <span className="text-sm text-text-secondary">{LEVEL_STATE_LABEL[levelState === "value" ? "not_set" : levelState]}</span>;
  }
  return (
    <div className="flex items-center gap-3">
      <div role="img" aria-label={`${label}: ${level} av 4`} className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-border-strong/40">
        <div className="h-full rounded-full bg-primary" style={{ width: `${(level / 4) * 100}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right whitespace-nowrap text-sm font-medium text-text-primary">{level} / 4</span>
    </div>
  );
}

function StatusBadge({ status }: { readonly status: AreaStatus }) {
  const StatusIcon = STATUS_ICON[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[status]}`}>
      <Icon icon={StatusIcon} size="inline" />
      {OVERVIEW_COPY.statusLabel[status]}
    </span>
  );
}

/**
 * Teamkompetanse overview (reference 21): profile radar, key figures, status donut, the single per-area list with plan
 * actions, and the priorities. Pure presentation: it receives already-derived areas and never reads a level or target from
 * a source of its own. An unset, withheld or unavailable value is labelled, never shown as zero.
 */
export function TeamCompetenceOverview({ teamId, areas, canEdit, mode, radar }: TeamCompetenceOverviewProps) {
  const statuses = areas.map((area) => ({ area, status: statusOf(area) }));
  const counts = countStatuses(statuses.map((entry) => entry.status));
  const total = areas.length;
  const setLevels = areas.flatMap((area) => (area.levelState === "value" && area.level !== null ? [area.level] : []));
  const average = setLevels.length === 0 ? null : setLevels.reduce((sum, level) => sum + level, 0) / setLevels.length;
  const priorities = priorityGroups(areas);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-label={OVERVIEW_COPY.profileHeading} className={CARD}>
          <div className="grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="min-w-0">{radar}</div>
            <dl className="flex flex-col gap-4 md:border-l md:border-border-subtle md:pl-6">
              <div>
                <dt className="sr-only">{OVERVIEW_COPY.keyFiguresHeading}</dt>
                <dd className="text-2xl font-semibold text-text-primary">{OVERVIEW_COPY.areasOnTarget(counts.meets, total)}</dd>
                <dd className="text-sm text-text-secondary">{OVERVIEW_COPY.areasOnTargetLabel}</dd>
              </div>
              <div>
                <dd className="text-2xl font-semibold text-text-primary">
                  {average === null ? OVERVIEW_COPY.levelNotSet : OVERVIEW_COPY.averageLevel(average.toFixed(1))}
                </dd>
                <dd className="text-sm text-text-secondary">{OVERVIEW_COPY.averageLabel}</dd>
              </div>
              <div>
                <dd className="text-2xl font-semibold text-text-primary">{`${setLevels.length} av ${total}`}</dd>
                <dd className="text-sm text-text-secondary">{OVERVIEW_COPY.areasWithLevelLabel}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section aria-labelledby="overview-status-heading" className={CARD}>
          <h2 id="overview-status-heading" className="text-lg font-semibold text-text-primary">
            {OVERVIEW_COPY.areasStatusHeading}
          </h2>
          <div className="flex flex-wrap items-center gap-6">
            <Donut counts={counts} total={total} />
            <ul className="flex min-w-0 flex-1 flex-col gap-3" aria-label={OVERVIEW_COPY.areasStatusHeading}>
              {AREA_STATUSES.map((status) => (
                <li key={status} className="flex items-center justify-between gap-3 text-sm text-text-primary">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="inline-block size-3 rounded-full" style={{ background: STATUS_SERIES_COLOR[status] }} />
                    {OVERVIEW_COPY.statusLabel[status]}
                  </span>
                  <span className="font-semibold">{counts[status]}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="rounded-field bg-info-subtle px-3 py-2 text-sm text-info-text">
            {mode === "automatic" ? OVERVIEW_COPY.automaticStatusNote : OVERVIEW_COPY.areasStatusNote}
          </p>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-labelledby="overview-table-heading" className={CARD}>
          <div className="flex flex-col gap-1">
            <h2 id="overview-table-heading" className="text-lg font-semibold text-text-primary">
              {OVERVIEW_COPY.tableHeading}
            </h2>
            <p className="text-sm text-text-secondary">{OVERVIEW_COPY.areasStatusIntro}</p>
          </div>
          {total === 0 ? (
            <p className="text-sm text-text-secondary">{OVERVIEW_COPY.priorityEmpty}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {statuses.map(({ area, status }) => {
                const name = area.name ?? OVERVIEW_COPY.unnamedArea;
                const visual = areaVisualFor(area.name, area.treeId);
                const tone = AREA_TONE_CLASSES[visual.tone];
                return (
                  <li key={area.treeId} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_12rem] sm:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center rounded-field ${tone.subtle}`}>
                        <Icon icon={visual.icon} size="inline" className={tone.text} />
                      </span>
                      <span className="min-w-0 break-words font-medium text-text-primary">{name}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      <LevelBar level={area.level} levelState={area.levelState} label={`${OVERVIEW_COPY.tableColumns.level}: ${name}`} />
                      <span className="text-xs text-text-secondary">
                        {OVERVIEW_COPY.tableColumns.target}: {area.target === null ? OVERVIEW_COPY.targetNotSet : `${area.target} / 4`}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 sm:flex-col sm:items-end sm:text-right">
                      <StatusBadge status={status} />
                      <PlanAction treeId={area.treeId} hasPlan={area.hasPlan} canEdit={canEdit} teamId={teamId} name={name} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="overview-priority-heading" className={CARD}>
          <h2 id="overview-priority-heading" className="text-lg font-semibold text-text-primary">
            {OVERVIEW_COPY.priorityHeading}
          </h2>
          <p className="text-sm text-text-secondary">{OVERVIEW_COPY.priorityIntro}</p>
          {priorities.gaps.length === 0 ? (
            <p className="text-sm text-text-secondary">{OVERVIEW_COPY.priorityEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {priorities.gaps.map((area) => {
                const name = area.name ?? OVERVIEW_COPY.unnamedArea;
                return (
                  <li key={area.treeId} className="flex flex-col gap-2 rounded-field border border-border-subtle p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 break-words font-medium text-text-primary">{name}</span>
                      <StatusBadge status={statusOf(area)} />
                    </div>
                    <PlanAction treeId={area.treeId} hasPlan={area.hasPlan} canEdit={canEdit} teamId={teamId} name={name} />
                  </li>
                );
              })}
            </ul>
          )}

          {priorities.awaitingData.length > 0 || priorities.withoutTarget > 0 ? (
            <div className="flex flex-col gap-2 border-t border-border-subtle pt-4 text-sm">
              {priorities.awaitingData.length > 0 ? (
                <p className="text-text-secondary">
                  <span className="font-medium text-text-primary">{OVERVIEW_COPY.awaitingHeading}: </span>
                  {OVERVIEW_COPY.awaitingCount(priorities.awaitingData.length)}. {OVERVIEW_COPY.awaitingIntro}
                </p>
              ) : null}
              {priorities.withoutTarget > 0 ? (
                <p className="text-text-secondary">
                  {OVERVIEW_COPY.withoutTargetCount(priorities.withoutTarget)}. {OVERVIEW_COPY.withoutTargetNote}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
