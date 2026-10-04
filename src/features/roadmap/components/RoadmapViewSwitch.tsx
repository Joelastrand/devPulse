"use client";

import { roadmapCopy } from "../copy";
import type { RoadmapView } from "../client/use-roadmap-view";

const VIEWS: readonly RoadmapView[] = ["list", "timeline"];

/** Liste | Tidslinje switch: real buttons with `aria-pressed` (SPEC BR-12). */
export function RoadmapViewSwitch({
  view,
  onChange,
}: {
  view: RoadmapView;
  onChange: (next: RoadmapView) => void;
}) {
  const { view: copy } = roadmapCopy;
  return (
    <div role="group" aria-label={copy.label} className="flex flex-wrap gap-2">
      {VIEWS.map((option) => {
        const pressed = view === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option)}
            className={`rounded border px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
              pressed
                ? "border-zinc-900 bg-zinc-900 font-semibold text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            {copy[option]}
          </button>
        );
      })}
    </div>
  );
}
