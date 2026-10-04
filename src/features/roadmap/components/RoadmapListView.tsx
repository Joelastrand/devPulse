"use client";

import type { RoadmapItemView } from "../server/list-roadmap-items";
import { roadmapCopy } from "../copy";
import { archivedRoadmapList, groupRoadmapList } from "../domain/roadmap-list";
import { RoadmapPlanCard, type RoadmapEditing } from "./RoadmapPlanCard";

const COMPLETED_REGION_ID = "roadmap-completed-region";

/**
 * List presentation of the already-filtered plans (SPEC BR-9a, BR-16, BR-17):
 * Pågår / Planlagt groups, the collapsed-by-default Fullført disclosure with
 * the filtered count, and a final separate Arkiverte section. Every plan
 * appears exactly once. Expansion state is owned by the page so the timeline
 * can share it later.
 */
export function RoadmapListView({
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
  const groups = groupRoadmapList(items);
  const archived = archivedRoadmapList(items);

  return (
    <>
      {groups.map((group) => {
        const headingId = `roadmap-group-${group.status}`;
        const label = `${roadmapCopy.status[group.status]} (${group.items.length})`;
        const cards = (
          <ul className="flex flex-col gap-3">
            {group.items.map((plan) => (
              <li key={plan.treeId}>
                <RoadmapPlanCard plan={plan} editing={editing} />
              </li>
            ))}
          </ul>
        );

        if (group.status !== "completed") {
          return (
            <section key={group.status} aria-labelledby={headingId} className="flex flex-col gap-2">
              <h2 id={headingId} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {roadmapCopy.status[group.status]}
              </h2>
              {cards}
            </section>
          );
        }

        return (
          <section key={group.status} aria-labelledby={headingId} className="flex flex-col gap-2">
            <h2 id={headingId} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              <button
                type="button"
                aria-expanded={completedExpanded}
                aria-controls={COMPLETED_REGION_ID}
                onClick={onToggleCompleted}
                className="rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {label}
              </button>
            </h2>
            <div id={COMPLETED_REGION_ID} hidden={!completedExpanded}>
              {completedExpanded && cards}
            </div>
          </section>
        );
      })}
      {archived.length > 0 && (
        <section aria-labelledby="roadmap-group-archived" className="flex flex-col gap-2">
          <h2 id="roadmap-group-archived" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {roadmapCopy.archivedHeading}
          </h2>
          <ul className="flex flex-col gap-3">
            {archived.map((plan) => (
              <li key={plan.treeId}>
                <RoadmapPlanCard plan={plan} editing={editing} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
