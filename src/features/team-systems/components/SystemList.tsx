import { Pencil } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { ASSESSMENT_ATTRIBUTES, ASSESSMENT_ATTRIBUTE_LABELS } from "../domain/team-system";
import type { TeamSystemView } from "../server/list-team-systems";
import { systemsCopy } from "../copy";
import { AssessmentStatusIcon, BackstageIconLink, BackstageLink, KnowledgeSummary, RiskBadge } from "./SystemStatusBadges";

/** Only the presentation-relevant fields are needed; `TeamSystemView` is passed through unchanged. */
export interface SystemListProps {
  systems: readonly TeamSystemView[];
  canEdit: boolean;
  onEdit: (system: TeamSystemView) => void;
}

function knowledgeNames(system: TeamSystemView): (string | null)[] {
  return system.knowledge.map((member) => member.displayName);
}

function EditButton({ system, onEdit }: { system: TeamSystemView; onEdit: (system: TeamSystemView) => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={() => onEdit(system)} aria-label={`${systemsCopy.editSystem} ${system.name}`}>
      <Icon icon={Pencil} size="inline" />
      {systemsCopy.matrix.edit}
    </Button>
  );
}

/**
 * The system matrix (reference 16). From the `lg` breakpoint up: one row per
 * system, one compact status icon per quality attribute, knowledge risk and
 * actions. Below it, system cards carry the same seven attributes in a compact
 * grid so no desktop table is squeezed onto a narrow screen.
 */
export function SystemList({ systems, canEdit, onEdit }: SystemListProps) {
  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Systemer i teamet</caption>
          <thead>
            <tr className="border-b border-border-subtle text-help text-text-muted">
              <th scope="col" className="px-3 py-2 font-medium">{systemsCopy.columns.system}</th>
              {ASSESSMENT_ATTRIBUTES.map((attribute) => (
                <th key={attribute} scope="col" className="px-2 py-2 text-center font-medium whitespace-nowrap">
                  <abbr title={ASSESSMENT_ATTRIBUTE_LABELS[attribute]} className="no-underline">
                    {systemsCopy.matrix.headers[attribute]}
                  </abbr>
                </th>
              ))}
              <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{systemsCopy.matrix.knowledgeHeader}</th>
              <th scope="col" className="px-3 py-2 font-medium">{systemsCopy.matrix.actionsHeader}</th>
            </tr>
          </thead>
          <tbody>
            {systems.map((system) => (
              <tr key={system.systemId} className="border-b border-border-subtle">
                <th scope="row" className="px-3 py-3 font-normal">
                  <span className="block text-label font-semibold text-text-primary">{system.name}</span>
                  <span className="block text-help text-text-muted">{system.description ?? systemsCopy.empty.noDescription}</span>
                </th>
                {ASSESSMENT_ATTRIBUTES.map((attribute) => (
                  <td key={attribute} className="px-2 py-3 text-center">
                    <span className="inline-flex items-center justify-center">
                      <AssessmentStatusIcon
                        attributeLabel={ASSESSMENT_ATTRIBUTE_LABELS[attribute]}
                        value={system.assessments[attribute].value}
                      />
                    </span>
                  </td>
                ))}
                <td className="px-3 py-3">
                  <RiskBadge band={system.knowledgeRisk} />
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <BackstageIconLink url={system.backstageUrl} systemName={system.name} />
                    {canEdit && <EditButton system={system} onEdit={onEdit} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-3 lg:hidden" aria-label="Systemer i teamet">
        {systems.map((system) => (
          <li key={system.systemId} className="flex flex-col gap-3 rounded-surface border border-border-subtle bg-surface p-4 shadow-card">
            <div className="flex flex-col gap-1">
              <h3 className="text-label font-semibold text-text-primary">{system.name}</h3>
              <p className="text-help text-text-muted">{system.description ?? systemsCopy.empty.noDescription}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RiskBadge band={system.knowledgeRisk} />
            </div>
            <div className="grid grid-cols-7 gap-1 text-center" role="list" aria-label="Kvalitetsvurderinger">
              {ASSESSMENT_ATTRIBUTES.map((attribute) => (
                <div key={attribute} role="listitem" className="flex flex-col items-center gap-1">
                  <AssessmentStatusIcon attributeLabel={ASSESSMENT_ATTRIBUTE_LABELS[attribute]} value={system.assessments[attribute].value} />
                  <span aria-hidden="true" className="text-[0.65rem] leading-tight text-text-muted">
                    {systemsCopy.matrix.headers[attribute]}
                  </span>
                </div>
              ))}
            </div>
            <div className="text-help text-text-secondary">
              <KnowledgeSummary names={knowledgeNames(system)} count={system.knowledge.length} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <BackstageLink url={system.backstageUrl} systemName={system.name} />
              {canEdit && <EditButton system={system} onEdit={onEdit} />}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
