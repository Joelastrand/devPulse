"use client";

import { roadmapCopy } from "../copy";
import type { TrackedAreaFacts } from "../domain/roadmap-mutation";
import { AreaPlanEditor } from "./RoadmapPlanEditor";
import type { PlanningActions } from "./RoadmapPlanning";

/**
 * `Områder uten plan` (SPEC BR-18): one page-level creation surface for the already-derived eligible
 * areas. It reuses the Feature A create path (`AreaPlanEditor` without a plan → existing POST and
 * validation); eligibility is decided by the caller from canonical data and nothing is removed locally.
 */
export function RoadmapUnplannedAreas({
  areas,
  actions,
}: {
  areas: readonly TrackedAreaFacts[];
  actions: PlanningActions;
}) {
  const { unplanned } = roadmapCopy;
  return (
    <section aria-labelledby="roadmap-unplanned-heading" className="flex flex-col gap-3">
      <h2 id="roadmap-unplanned-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {unplanned.heading}
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{unplanned.help}</p>
      <ul className="flex flex-col gap-3">
        {areas.map((area) => (
          <li
            key={area.treeId}
            className="flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <h3 className="break-words text-base font-semibold text-zinc-900 dark:text-zinc-50">{area.name}</h3>
            <AreaPlanEditor area={area} plan={undefined} canEdit actions={actions} />
          </li>
        ))}
      </ul>
    </section>
  );
}
