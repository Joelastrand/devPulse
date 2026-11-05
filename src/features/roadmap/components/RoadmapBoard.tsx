"use client";

import { useEffect, useState } from "react";
import type { RoadmapItemView } from "../server/list-roadmap-items";
import { roadmapCopy } from "../copy";
import { isValidPlanDate, planningToday } from "../domain/roadmap-dates";
import { quarterOf, type RoadmapQuarter } from "../domain/roadmap-timeline";
import { StatTile } from "../../../components/ui/dashboard/DashboardPrimitives";
import { RoadmapPlanCard, type RoadmapEditing } from "./RoadmapPlanCard";
import { ownerText } from "./RoadmapPlanSummary";

/**
 * Quarter-column board (visual-redesign TASK-009, SPEC BR-16/BR-17). One column per calendar quarter of the plans'
 * target dates, plus an "Uten måldato" column for plans without a valid target date. Each plan is one card in exactly
 * one column; nothing spans columns and no bars are drawn. The board scrolls inside its own region, never the page.
 */

export interface RoadmapBoardColumn {
  key: string;
  label: string;
  /** "jan–mar" style month range; `null` for the undated column. */
  monthRange: string | null;
  /** True for the calendar quarter that contains `today`. */
  current: boolean;
  plans: RoadmapItemView[];
}

function monthRangeOf(quarter: RoadmapQuarter): string {
  const names = roadmapCopy.board.monthNames;
  const first = names[(quarter.quarter - 1) * 3];
  const last = names[(quarter.quarter - 1) * 3 + 2];
  return `${first}–${last}`;
}

/**
 * Columns in calendar order, then the undated column. Pure: the current quarter is derived from the `today` plan date
 * passed in (`null` when unknown), so callers and tests control the clock.
 */
export function buildRoadmapBoardColumns(
  items: readonly RoadmapItemView[],
  today: string | null = null,
): RoadmapBoardColumn[] {
  const currentKey = today !== null && isValidPlanDate(today) ? quarterOf(today).key : null;
  const quarters = new Map<string, { quarter: RoadmapQuarter; plans: RoadmapItemView[] }>();
  const undated: RoadmapItemView[] = [];

  for (const plan of items) {
    if (plan.targetDate !== null && isValidPlanDate(plan.targetDate)) {
      const quarter = quarterOf(plan.targetDate);
      const entry = quarters.get(quarter.key) ?? { quarter, plans: [] };
      entry.plans.push(plan);
      quarters.set(quarter.key, entry);
    } else {
      undated.push(plan);
    }
  }

  const columns: RoadmapBoardColumn[] = [...quarters.values()]
    .sort((a, b) => (a.quarter.key < b.quarter.key ? -1 : a.quarter.key > b.quarter.key ? 1 : 0))
    .map(({ quarter, plans }) => ({
      key: quarter.key,
      label: quarter.label,
      monthRange: monthRangeOf(quarter),
      current: quarter.key === currentKey,
      plans,
    }));

  if (undated.length > 0) {
    columns.push({
      key: "undated",
      label: roadmapCopy.board.undatedColumn,
      monthRange: null,
      current: false,
      plans: undated,
    });
  }
  return columns;
}

function StatusTiles({ items }: { items: readonly RoadmapItemView[] }) {
  const count = (predicate: (plan: RoadmapItemView) => boolean) => String(items.filter(predicate).length);
  const tiles = roadmapCopy.board.statusTiles;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile label={tiles.planned} value={count((plan) => plan.status === "planned")} />
      <StatTile label={tiles.active} value={count((plan) => plan.status === "active")} />
      <StatTile label={tiles.completed} value={count((plan) => plan.status === "completed")} />
      <StatTile label={tiles.overdue} value={count((plan) => plan.overdue)} />
    </div>
  );
}

/** The card's visible text, from existing fields only: area, target title, status, priority and owner. */
function BoardCardText({ plan }: { plan: RoadmapItemView }) {
  const title = plan.targetAvailable && plan.targetLabel !== null ? plan.targetLabel : roadmapCopy.targetUnavailable;
  return (
    <>
      <span className="text-help text-text-secondary">{plan.areaName ?? roadmapCopy.untracked.unnamedArea}</span>
      <span className="font-medium text-text-primary">{title}</span>
      <span className="text-help">{roadmapCopy.board.statusTiles[plan.overdue ? "overdue" : plan.status]}</span>
      <span className="text-help">
        {roadmapCopy.labels.priority}: {roadmapCopy.priority[plan.priority]}
      </span>
      <span className="text-help">
        {roadmapCopy.labels.owner}: {ownerText(plan.owner)}
      </span>
    </>
  );
}

/**
 * True from the md breakpoint up, when the board replaces the grouped list. Starts false, so the list renders
 * until the viewport is known and without `matchMedia` (for example in jsdom). Exactly one of the two views is
 * rendered at a time, so no plan appears twice in the DOM.
 */
export function useWideRoadmapBoard(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(min-width: 768px)")
        : null;
    if (!query) return;
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

export function RoadmapBoard({
  items,
  editing,
  today,
}: {
  items: readonly RoadmapItemView[];
  editing: RoadmapEditing | null;
  /** Plan date (YYYY-MM-DD) that marks the current quarter. Defaults to today in the planning time zone. */
  today?: string;
}) {
  const columns = buildRoadmapBoardColumns(items, today ?? planningToday(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((plan) => plan.treeId === selectedId) ?? items[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <StatusTiles items={items} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
        <div className="min-w-0 overflow-x-auto" role="region" aria-label={roadmapCopy.board.description}>
          <div className="flex min-w-max gap-3 pb-2">
            {columns.map((column) => (
              <section
                key={column.key}
                aria-labelledby={`roadmap-board-${column.key}`}
                className="flex w-64 shrink-0 flex-col gap-2 rounded-control border border-border-subtle bg-surface-subtle p-3"
              >
                <header className="flex flex-col gap-0.5">
                  <h3 id={`roadmap-board-${column.key}`} className="text-label font-semibold text-text-primary">
                    {column.label}
                  </h3>
                  {column.monthRange !== null ? (
                    <p className="text-help text-text-secondary">
                      {column.monthRange}
                      {column.current ? ` · ${roadmapCopy.board.currentQuarter}` : ""}
                    </p>
                  ) : null}
                </header>
                <ul className="flex flex-col gap-2">
                  {column.plans.map((plan) => {
                    const isSelected = selected?.treeId === plan.treeId;
                    return (
                      <li key={plan.treeId}>
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setSelectedId(plan.treeId)}
                          className={`flex w-full flex-col gap-1 rounded-control border px-3 py-2 text-left text-label ${
                            isSelected
                              ? "border-primary bg-surface text-text-primary"
                              : "border-border-subtle bg-surface text-text-secondary"
                          }`}
                        >
                          <BoardCardText plan={plan} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
        <aside aria-labelledby="roadmap-board-detail-heading" className="flex min-w-0 flex-col gap-3">
          <h3 id="roadmap-board-detail-heading" className="text-section-title font-semibold text-text-primary">
            {roadmapCopy.board.detailHeading}
          </h3>
          {selected ? (
            <RoadmapPlanCard plan={selected} editing={editing} />
          ) : (
            <p className="text-help text-text-secondary">{roadmapCopy.board.detailEmpty}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
