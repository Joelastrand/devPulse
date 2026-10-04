"use client";

import type { RoadmapItemView } from "../server/list-roadmap-items";
import { roadmapCopy } from "../copy";
import { groupRoadmapTimeline, type RoadmapTimelineGroup } from "../domain/roadmap-timeline";
import { RoadmapPlanCard, type RoadmapEditing } from "./RoadmapPlanCard";

const COMPLETED_REGION_ID = "roadmap-timeline-completed-region";

function groupLabel(group: RoadmapTimelineGroup<RoadmapItemView>): string {
  const { timeline } = roadmapCopy;
  switch (group.kind) {
    case "quarter":
      return group.quarter.label;
    case "overdue":
      return timeline.overdue;
    case "start-only":
      return timeline.startOnly;
    case "undated":
      return timeline.undated;
    case "completed":
      return roadmapCopy.toggles.completed;
    case "archived":
      return roadmapCopy.archivedHeading;
  }
}

function groupKey(group: RoadmapTimelineGroup<RoadmapItemView>): string {
  return group.kind === "quarter" ? `quarter-${group.quarter.key}` : group.kind;
}

/**
 * Lightweight vertical timeline of the already-filtered plans (SPEC BR-9–BR-11):
 * a heading per `groupRoadmapTimeline` group, plans in an ordered list, every
 * fact as text. Grouping and ordering come entirely from the domain helper; the
 * completed disclosure state is owned by the page and shared with the list.
 */
export function RoadmapTimelineView({
  items,
  editing,
  completedExpanded,
  onToggleCompleted,
}: {
  items: readonly RoadmapItemView[];
  editing: RoadmapEditing | null;
  completedExpanded: boolean;
  onToggleCompleted: () => void;
}) {
  return (
    <>
      {groupRoadmapTimeline(items).map((group) => {
        const key = groupKey(group);
        const headingId = `roadmap-timeline-${key}`;
        const label = groupLabel(group);
        const rows = (
          <ol className="flex flex-col gap-3">
            {group.items.map((plan) => (
              <li key={plan.treeId}>
                <RoadmapPlanCard plan={plan} editing={editing} />
              </li>
            ))}
          </ol>
        );

        if (group.kind !== "completed") {
          return (
            <section key={key} aria-labelledby={headingId} className="flex flex-col gap-2">
              <h2 id={headingId} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {label}
              </h2>
              {rows}
            </section>
          );
        }

        return (
          <section key={key} aria-labelledby={headingId} className="flex flex-col gap-2">
            <h2 id={headingId} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              <button
                type="button"
                aria-expanded={completedExpanded}
                aria-controls={COMPLETED_REGION_ID}
                onClick={onToggleCompleted}
                className="rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {`${label} (${group.items.length})`}
              </button>
            </h2>
            <div id={COMPLETED_REGION_ID} hidden={!completedExpanded}>
              {completedExpanded && rows}
            </div>
          </section>
        );
      })}
    </>
  );
}
