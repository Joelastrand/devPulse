import { Search } from "lucide-react";
import { cx, FORM_CONTROL_CLASSNAME, FORM_CONTROL_HEIGHT_CLASSNAME } from "../../../components/ui/class-names";
import { FieldLabel } from "../../../components/ui/FieldLabel";
import { Icon } from "../../../components/ui/Icon";
import { Select } from "../../../components/ui/Select";
import { KNOWLEDGE_RISK_LABELS, type KnowledgeRiskBand } from "../domain/team-system";
import type { AttentionFilter, KnowledgeFilter, SystemFilter } from "../domain/team-system-summary";
import { KNOWLEDGE_BAND_ORDER } from "../domain/team-system-summary";
import { systemsCopy } from "../copy";

/** BR-13: search plus two exact filters. Controlled: the page owns the state. */
export function SystemFilters({
  filter,
  onChange,
}: {
  filter: SystemFilter;
  onChange: (next: SystemFilter) => void;
}) {
  return (
    <form role="search" aria-label="Filtrer systemer" className="flex flex-col gap-3 md:flex-row md:items-end" onSubmit={(event) => event.preventDefault()}>
      {/* The icon is positioned against this wrapper, which contains only the input, so it centres on the control and not on the label above it. */}
      <div className="flex flex-1 flex-col gap-2">
        <FieldLabel htmlFor="system-search" label={systemsCopy.search.label} />
        <div className="relative">
          <input
            id="system-search"
            type="search"
            placeholder={systemsCopy.search.placeholder}
            value={filter.query}
            className={cx(FORM_CONTROL_CLASSNAME, FORM_CONTROL_HEIGHT_CLASSNAME, "pl-10")}
            onChange={(event) => onChange({ ...filter, query: event.target.value })}
          />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted">
            <Icon icon={Search} size="inline" />
          </span>
        </div>
      </div>
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
    </form>
  );
}
