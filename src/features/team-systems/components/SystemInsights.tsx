import type { LucideIcon } from "lucide-react";
import { Card } from "../../../components/ui/Card";
import { CollapsibleSection } from "../../../components/ui/CollapsibleSection";
import { Icon } from "../../../components/ui/Icon";
import { Monitor, ShieldCheck, TriangleAlert, Users, Wrench, CircleCheck, Server, Gauge, FlaskConical, Rocket, Eye } from "lucide-react";
import { KNOWLEDGE_BAND_ORDER } from "../domain/team-system-summary";
import type { TeamSystemSummary } from "../domain/team-system-summary";
import {
  ASSESSMENT_ATTRIBUTES,
  ASSESSMENT_VALUES,
  ASSESSMENT_VALUE_LABELS,
  KNOWLEDGE_RISK_LABELS,
  type AssessmentAttribute,
  type AssessmentValue,
} from "../domain/team-system";
import { systemsCopy } from "../copy";

/** One distinct icon per attribute. The label and explanation are always printed as text too, so the icon is never the only cue. */
const ATTRIBUTE_ICONS: Record<AssessmentAttribute, LucideIcon> = {
  availability: Server,
  reliability: Gauge,
  maintainability: Wrench,
  security: ShieldCheck,
  testability: FlaskConical,
  deployability: Rocket,
  observability: Eye,
};

interface SummaryCardProps {
  icon: LucideIcon;
  value: number;
  label: string;
  help: string;
}

function SummaryCard({ icon, value, label, help }: SummaryCardProps) {
  return (
    <Card as="li" variant="bordered" padding="md" className="flex items-start gap-4">
      <span aria-hidden="true" className="rounded-control bg-surface-subtle p-2 text-primary">
        <Icon icon={icon} size="action" />
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-metric font-semibold text-text-primary">{value}</span>
        <span className="text-label font-medium text-text-primary">{label}</span>
        <span className="text-help text-text-muted">{help}</span>
      </div>
    </Card>
  );
}

/** BR-11 cards. Counts from the authorized list only; no percentages, no member totals. */
export function SystemSummaryCards({ summary }: { summary: TeamSystemSummary }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Oppsummering">
      <SummaryCard icon={Monitor} value={summary.total} label={systemsCopy.summary.systems} help={systemsCopy.summary.systemsHelp} />
      <SummaryCard icon={CircleCheck} value={summary.inGoodStanding} label={systemsCopy.summary.inGoodStanding} help={systemsCopy.summary.inGoodStandingHelp} />
      <SummaryCard icon={TriangleAlert} value={summary.needingAttention} label={systemsCopy.summary.attention} help={systemsCopy.summary.attentionHelp} />
      <SummaryCard icon={Users} value={summary.knowledgeRiskCount} label={systemsCopy.summary.knowledgeRisk} help={systemsCopy.summary.knowledgeRiskHelp} />
    </ul>
  );
}

/** BR-12: counts per band and the single-person count. No names, no ranking. */
export function KnowledgeRiskPanel({
  summary,
  open,
  onOpenChange,
}: {
  summary: TeamSystemSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <CollapsibleSection
      id="systems-knowledge-risk"
      title={systemsCopy.knowledgeRiskPanel.title}
      description={systemsCopy.knowledgeRiskPanel.description}
      icon={<Icon icon={Users} size="action" />}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {KNOWLEDGE_BAND_ORDER.map((band) => (
          <li key={band} className="flex flex-col gap-1 rounded-control bg-surface-subtle px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 text-label font-semibold text-text-primary">{KNOWLEDGE_RISK_LABELS[band]}</span>
              <span className="shrink-0 whitespace-nowrap text-label font-semibold text-text-primary">
                {summary.byBand[band]} {summary.byBand[band] === 1 ? "system" : "systemer"}
              </span>
            </div>
            <span className="text-help text-text-secondary">{systemsCopy.knowledgeRiskPanel.bands[band]}</span>
          </li>
        ))}
      </ul>
      <p className="text-help text-text-secondary">
        {systemsCopy.knowledgeRiskPanel.singlePerson(summary.singleKnowledgePersonCount)}
        {" — "}
        {systemsCopy.knowledgeRiskPanel.singlePersonHelp}
      </p>
      </div>
    </CollapsibleSection>
  );
}

/** Explains the three prioritized attributes. Qualitative team self-assessments only (BR-14). Explanatory, so collapsed by default. */
export function QualityPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const attributes = ASSESSMENT_ATTRIBUTES.map((attribute) => ({
    icon: ATTRIBUTE_ICONS[attribute],
    copy: systemsCopy.qualityPanel[attribute],
  }));
  return (
    <CollapsibleSection
      id="systems-quality"
      title={systemsCopy.qualityPanel.title}
      description={systemsCopy.qualityPanel.description}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {attributes.map(({ icon, copy }) => (
          <li key={copy.title} className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-label font-semibold text-text-primary">
              <span aria-hidden="true" className="text-primary">
                <Icon icon={icon} size="inline" />
              </span>
              {copy.title}
            </span>
            <span className="text-help text-text-secondary">{copy.body}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
        <h3 className="text-label font-semibold text-text-primary">{systemsCopy.explanation.statusTitle}</h3>
        <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {ASSESSMENT_VALUES.map((value: AssessmentValue) => (
            <div key={value} className="flex flex-col">
              <dt className="text-label font-medium text-text-primary">{ASSESSMENT_VALUE_LABELS[value]}</dt>
              <dd className="text-help text-text-secondary">{systemsCopy.explanation.statusHelp[value]}</dd>
            </div>
          ))}
        </dl>
      </div>
      </div>
    </CollapsibleSection>
  );
}
