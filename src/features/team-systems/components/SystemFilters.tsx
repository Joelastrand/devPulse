import { Search, Star } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { cx, FORM_CONTROL_CLASSNAME, FORM_CONTROL_HEIGHT_CLASSNAME } from "../../../components/ui/class-names";
import { FieldLabel } from "../../../components/ui/FieldLabel";
import { Icon } from "../../../components/ui/Icon";
import { Select } from "../../../components/ui/Select";
import {
  BUSINESS_CRITICALITIES,
  BUSINESS_CRITICALITY_LABELS,
  KNOWLEDGE_RISK_LABELS,
  SYSTEM_TYPES,
  type BusinessCriticality,
  type KnowledgeRiskBand,
  type SystemType,
} from "../domain/team-system";
import {
  DEFAULT_SYSTEM_FILTER,
  KNOWLEDGE_BAND_ORDER,
  countActiveFilters,
  type AttentionFilter,
  type CriticalityFilter,
  type KnowledgeFilter,
  type SystemFilter,
  type SystemTypeFilter,
} from "../domain/team-system-summary";
import { systemsCopy } from "../copy";

/**
 * Search stays prominent on its own row. The common filters share a responsive grid (one column on phones, up to four on wide
 * screens), so no control is wider than its cell and nothing overflows the page. "Kun favoritter" is a toggle with a text
 * label and a pressed state. The active-filter count and the reset action appear only when a filter differs from its default.
 * Controlled: the page owns the state.
 */
export function SystemFilters({
  filter,
  onChange,
}: {
  filter: SystemFilter;
  onChange: (next: SystemFilter) => void;
}) {
  const activeCount = countActiveFilters(filter);
  return (
    <form role="search" aria-label="Filtrer systemer" className="flex flex-col gap-4" onSubmit={(event) => event.preventDefault()}>
      {/* The icon is positioned against this wrapper, which contains only the input, so it centres on the control and not on the label above it. */}
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="system-search" label={systemsCopy.search.label} />
        <div className="relative">
          <input
            id="system-search"
            type="search"
            placeholder={systemsCopy.search.placeholder}
            value={filter.query}
            className={cx(FORM_CONTROL_CLASSNAME, FORM_CONTROL_HEIGHT_CLASSNAME, "w-full pl-10")}
            onChange={(event) => onChange({ ...filter, query: event.target.value })}
          />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted">
            <Icon icon={Search} size="inline" />
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Select
          id="system-filter-type"
          label={systemsCopy.filters.systemTypeLabel}
          value={filter.systemType}
          onChange={(event) => onChange({ ...filter, systemType: event.target.value as SystemTypeFilter })}
        >
          <option value="all">{systemsCopy.filters.systemTypeAll}</option>
          {SYSTEM_TYPES.map((type: SystemType) => (
            <option key={type} value={type}>
              {systemsCopy.filters.systemTypeOptions[type]}
            </option>
          ))}
        </Select>
        <Select
          id="system-filter-attention"
          label={systemsCopy.filters.attentionLabel}
          value={filter.attention}
          onChange={(event) => onChange({ ...filter, attention: event.target.value as AttentionFilter })}
        >
          <option value="all">{systemsCopy.filters.attentionAll}</option>
          <option value="attention">{systemsCopy.filters.attentionOnly}</option>
        </Select>
        <Select
          id="system-filter-knowledge"
          label={systemsCopy.filters.knowledgeLabel}
          value={filter.knowledge}
          onChange={(event) => onChange({ ...filter, knowledge: event.target.value as KnowledgeFilter })}
        >
          <option value="all">{systemsCopy.filters.knowledgeAll}</option>
          {KNOWLEDGE_BAND_ORDER.map((band: KnowledgeRiskBand) => (
            <option key={band} value={band}>
              {KNOWLEDGE_RISK_LABELS[band]}
            </option>
          ))}
        </Select>
        <Select
          id="system-filter-criticality"
          label={systemsCopy.filters.criticalityLabel}
          value={filter.criticality}
          onChange={(event) => onChange({ ...filter, criticality: event.target.value as CriticalityFilter })}
        >
          <option value="all">{systemsCopy.filters.criticalityAll}</option>
          {BUSINESS_CRITICALITIES.map((level: BusinessCriticality) => (
            <option key={level} value={level}>
              {BUSINESS_CRITICALITY_LABELS[level]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-pressed={filter.favoritesOnly}
          onClick={() => onChange({ ...filter, favoritesOnly: !filter.favoritesOnly })}
          className={cx("inline-flex items-center gap-2", filter.favoritesOnly && "border-primary text-primary")}
        >
          <Icon icon={Star} size="inline" className={filter.favoritesOnly ? "fill-current" : undefined} />
          {systemsCopy.filters.favoritesOnly}
        </Button>
        {activeCount > 0 && (
          <>
            <span className="text-help text-text-secondary">{systemsCopy.list.activeFilters(activeCount)}</span>
            <Button type="button" variant="tertiary" size="sm" onClick={() => onChange(DEFAULT_SYSTEM_FILTER)}>
              {systemsCopy.list.resetFilters}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
