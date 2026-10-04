"use client";

import { Select } from "../../../components/ui/Select";
import { roadmapCopy } from "../copy";
import type { RoadmapFilter } from "../domain/roadmap-filter";
import type { RoadmapPriority, RoadmapStatus } from "../domain/roadmap-item";

const STATUS_ORDER: readonly RoadmapStatus[] = ["active", "planned", "completed"];
const PRIORITY_ORDER: readonly RoadmapPriority[] = ["high", "medium", "low"];

/**
 * The closed filter set (SPEC BR-14): Status, Prioritet and Vis arkiverte.
 * Controlled and purely presentational; values are validated against the
 * persisted vocabularies before they reach the filter state.
 */
export function RoadmapFilterBar({
  filter,
  onChange,
}: {
  filter: RoadmapFilter;
  onChange: (next: RoadmapFilter) => void;
}) {
  const { filters, status, priority } = roadmapCopy;

  return (
    <fieldset className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3 border-0 p-0">
      <legend className="sr-only">{filters.legend}</legend>
      <Select
        id="roadmap-filter-status"
        label={filters.status}
        value={filter.status}
        onChange={(event) => {
          const value = STATUS_ORDER.find((candidate) => candidate === event.target.value);
          onChange({ ...filter, status: value ?? "all" });
        }}
      >
        <option value="all">{filters.all}</option>
        {STATUS_ORDER.map((value) => (
          <option key={value} value={value}>
            {status[value]}
          </option>
        ))}
      </Select>
      <Select
        id="roadmap-filter-priority"
        label={filters.priority}
        value={filter.priority}
        onChange={(event) => {
          const value = PRIORITY_ORDER.find((candidate) => candidate === event.target.value);
          onChange({ ...filter, priority: value ?? "all" });
        }}
      >
        <option value="all">{filters.all}</option>
        {PRIORITY_ORDER.map((value) => (
          <option key={value} value={value}>
            {priority[value]}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 pb-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
        <input
          type="checkbox"
          checked={filter.showArchived}
          onChange={(event) => onChange({ ...filter, showArchived: event.target.checked })}
          className="h-4 w-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        />
        {filters.showArchived}
      </label>
    </fieldset>
  );
}
