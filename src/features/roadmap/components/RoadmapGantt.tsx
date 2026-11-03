import type { RoadmapItemView } from "../server/list-roadmap-items";
import { roadmapCopy } from "../copy";
import type { RoadmapStatus } from "../domain/roadmap-item";

/**
 * Quarter-axis timeline for plans that have both a start and a target date.
 * Bars are placed from those dates only; nothing is estimated and no progress
 * is drawn. Plans without both dates are left to the list view below, which
 * remains the accessible source for every plan.
 */

const BAR_CLASSNAMES: Record<RoadmapStatus, string> = {
  planned: "border border-primary/40 bg-primary-subtle text-text-primary",
  active: "bg-primary text-primary-text",
  completed: "bg-success-subtle text-success-text",
};

const LEGEND_DOT_CLASSNAMES: Record<RoadmapStatus, string> = {
  planned: "border border-primary/40 bg-primary-subtle",
  active: "bg-primary",
  completed: "bg-success-subtle",
};

const AREA_COLUMN = "11rem";

interface DatedPlan {
  plan: RoadmapItemView;
  startMs: number;
  endMs: number;
}

interface QuarterSlot {
  label: string;
  startMs: number;
  endMs: number;
}

function parseDate(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function quarterIndex(ms: number): number {
  const date = new Date(ms);
  return date.getUTCFullYear() * 4 + Math.floor(date.getUTCMonth() / 3);
}

function quarterSlot(index: number): QuarterSlot {
  const year = Math.floor(index / 4);
  const quarter = index % 4;
  return {
    label: `Q${quarter + 1} ${year}`,
    startMs: Date.UTC(year, quarter * 3, 1),
    endMs: Date.UTC(year, quarter * 3 + 3, 1),
  };
}

function datedPlans(items: readonly RoadmapItemView[]): DatedPlan[] {
  return items.flatMap((plan) => {
    if (plan.archived || plan.startDate === null || plan.targetDate === null) return [];
    const startMs = parseDate(plan.startDate);
    const endMs = parseDate(plan.targetDate);
    if (startMs === null || endMs === null) return [];
    return [{ plan, startMs: Math.min(startMs, endMs), endMs: Math.max(startMs, endMs) }];
  });
}

export function RoadmapGantt({ items }: { items: readonly RoadmapItemView[] }) {
  const { timeline } = roadmapCopy;
  const dated = datedPlans(items);

  if (dated.length === 0) {
    return <p className="text-body-secondary text-text-secondary">{timeline.ganttEmpty}</p>;
  }

  const firstIndex = Math.min(...dated.map((entry) => quarterIndex(entry.startMs)));
  const lastIndex = Math.max(firstIndex + 3, ...dated.map((entry) => quarterIndex(entry.endMs)));
  const quarters = Array.from({ length: lastIndex - firstIndex + 1 }, (_, offset) => quarterSlot(firstIndex + offset));
  const rangeStart = quarters[0].startMs;
  const span = quarters[quarters.length - 1].endMs - rangeStart;
  const position = (ms: number) => ((ms - rangeStart) / span) * 100;
  const columns = { gridTemplateColumns: `${AREA_COLUMN} minmax(0, 1fr)` };

  const rows = new Map<string, DatedPlan[]>();
  for (const entry of dated) {
    const key = entry.plan.areaName ?? timeline.ganttNoArea;
    rows.set(key, [...(rows.get(key) ?? []), entry]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div>
          <div className="grid border-b border-border-subtle pb-2 text-help text-text-muted" style={columns}>
            <span>{timeline.ganttArea}</span>
            <div className="grid" style={{ gridTemplateColumns: `repeat(${quarters.length}, minmax(0, 1fr))` }}>
              {quarters.map((quarter) => (
                <span key={quarter.label} className="border-l border-border-subtle pl-2">
                  {quarter.label}
                </span>
              ))}
            </div>
          </div>
          {[...rows.entries()].map(([area, entries]) => (
            <div key={area} className="grid items-start border-b border-border-subtle py-3" style={columns}>
              <span className="pr-3 text-label font-medium text-text-primary">{area}</span>
              <div className="relative flex flex-col gap-1.5">
                {entries.map(({ plan, startMs, endMs }) => {
                  const left = position(startMs);
                  const width = Math.max(position(endMs) - left, 4);
                  return (
                    <div
                      key={plan.treeId}
                      className={`truncate rounded-control px-3 py-1.5 text-help font-medium ${BAR_CLASSNAMES[plan.status]}`}
                      style={{ marginLeft: `${left}%`, width: `${width}%` }}
                    >
                      {plan.targetLabel ?? timeline.ganttNoArea}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <ul className="flex flex-wrap gap-4 text-help text-text-secondary">
        {(Object.keys(timeline.ganttLegend) as RoadmapStatus[]).map((status) => (
          <li key={status} className="flex items-center gap-2">
            <span aria-hidden="true" className={`size-3 rounded-full ${LEGEND_DOT_CLASSNAMES[status]}`} />
            {timeline.ganttLegend[status]}
          </li>
        ))}
      </ul>
    </div>
  );
}
