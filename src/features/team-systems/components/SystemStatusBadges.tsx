import { CircleCheck, CircleMinus, CircleX, ExternalLink, TriangleAlert, type LucideIcon } from "lucide-react";
import { StatusBadge, type StatusTone } from "../../../components/ui/StatusBadge";
import { Icon } from "../../../components/ui/Icon";
import {
  ASSESSMENT_VALUE_LABELS,
  KNOWLEDGE_RISK_LABELS,
  type AssessmentValue,
  type KnowledgeRiskBand,
} from "../domain/team-system";
import { systemsCopy } from "../copy";

/** Tone is a visual aid only; the label text always carries the meaning (never colour alone). */
const ASSESSMENT_TONE: Record<AssessmentValue, StatusTone> = {
  god: "success",
  trenger_oppfolging: "warning",
  kritisk: "danger",
  ikke_vurdert: "neutral",
};

const RISK_TONE: Record<KnowledgeRiskBand, StatusTone> = {
  none: "danger",
  high: "danger",
  elevated: "warning",
  lower: "success",
};

export function AssessmentBadge({ value }: { value: AssessmentValue }) {
  return <StatusBadge tone={ASSESSMENT_TONE[value]}>{ASSESSMENT_VALUE_LABELS[value]}</StatusBadge>;
}

export function AttentionBadge({ attention, assessedAny }: { attention: boolean; assessedAny: boolean }) {
  if (attention) {
    return <StatusBadge tone="warning">{systemsCopy.attentionState.attention}</StatusBadge>;
  }
  if (!assessedAny) {
    return <StatusBadge tone="neutral">{systemsCopy.attentionState.notAssessed}</StatusBadge>;
  }
  return <StatusBadge tone="success">{systemsCopy.attentionState.ok}</StatusBadge>;
}

export function RiskBadge({ band }: { band: KnowledgeRiskBand }) {
  return <StatusBadge tone={RISK_TONE[band]}>{KNOWLEDGE_RISK_LABELS[band]}</StatusBadge>;
}

/**
 * "Åpne i Backstage" (BR-15). Opens in a new tab with `noopener noreferrer`;
 * the accessible name names the system. Without a URL nothing is linked.
 */
export function BackstageLink({ url, systemName }: { url: string | null; systemName: string }) {
  if (url === null) {
    return <span className="text-help text-text-muted">{systemsCopy.empty.noBackstageLink}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={systemsCopy.backstage.openFor(systemName)}
      className="inline-flex items-center gap-1 text-label font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {systemsCopy.backstage.open}
      <Icon icon={ExternalLink} size="inline" />
    </a>
  );
}

export function KnowledgeSummary({ names, count }: { names: readonly (string | null)[]; count: number }) {
  if (count === 0) {
    return <span className="text-help text-text-muted">{systemsCopy.empty.noKnowledgeTitle}</span>;
  }
  const shown = names.slice(0, 3).map((name) => name ?? systemsCopy.form.unnamedMember);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-help text-text-secondary">{systemsCopy.knowledgeCount(count)}</span>
      {shown.length > 0 && <span className="text-help text-text-muted">{shown.join(", ")}{count > shown.length ? " …" : ""}</span>}
    </div>
  );
}

const ASSESSMENT_ICON_CLASS: Record<AssessmentValue, string> = {
  god: "text-success-text",
  trenger_oppfolging: "text-warning-text",
  kritisk: "text-danger-text",
  ikke_vurdert: "text-text-muted",
};

const ASSESSMENT_ICON: Record<AssessmentValue, LucideIcon> = {
  god: CircleCheck,
  trenger_oppfolging: TriangleAlert,
  kritisk: CircleX,
  ikke_vurdert: CircleMinus,
};

/**
 * One qualitative assessment as a single icon (reference 16). The icon's
 * accessible name carries the attribute and the status, e.g. "Sikkerhet: Kritisk",
 * so the meaning never depends on colour or on the icon shape alone.
 */
export function AssessmentStatusIcon({ attributeLabel, value }: { attributeLabel: string; value: AssessmentValue }) {
  return (
    <Icon
      icon={ASSESSMENT_ICON[value]}
      size="action"
      label={`${attributeLabel}: ${ASSESSMENT_VALUE_LABELS[value]}`}
      className={ASSESSMENT_ICON_CLASS[value]}
    />
  );
}

/** Compact external Backstage action for the matrix; keeps the same accessible name as `BackstageLink`. */
export function BackstageIconLink({ url, systemName }: { url: string | null; systemName: string }) {
  if (url === null) {
    return <span className="text-help text-text-muted">{systemsCopy.empty.noBackstageLink}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={systemsCopy.backstage.openFor(systemName)}
      title={systemsCopy.backstage.open}
      className="inline-flex size-9 items-center justify-center rounded-control text-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <Icon icon={ExternalLink} size="action" />
    </a>
  );
}
