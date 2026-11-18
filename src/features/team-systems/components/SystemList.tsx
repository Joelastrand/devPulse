import Link from "next/link";
import { ChevronRight, CircleHelp, Building2, Globe, Star } from "lucide-react";
import { Icon } from "../../../components/ui/Icon";
import {
  ASSESSMENT_ATTRIBUTES,
  ASSESSMENT_ATTRIBUTE_LABELS,
  BUSINESS_CRITICALITY_LABELS,
  SYSTEM_TYPE_LABELS,
  USER_REACH_LABELS,
  type SystemClassification,
  type SystemType,
} from "../domain/team-system";
import type { TeamSystemView } from "../server/list-team-systems";
import { systemsCopy } from "../copy";
import { AssessmentStatusIcon, BackstageIconLink, BackstageLink, KnowledgeSummary, RiskBadge } from "./SystemStatusBadges";

/** The list's presentation inputs. `returnQuery` is the current list state, so a detail page can return to exactly this view. */
export interface SystemListProps {
  teamId: string;
  systems: readonly TeamSystemView[];
  returnQuery: string;
  favoriteIds: ReadonlySet<string>;
  /** False while favorites are loading or unavailable: the star is then disabled, never shown as a confirmed state. */
  favoritesReady: boolean;
  pendingFavoriteIds: ReadonlySet<string>;
  onToggleFavorite: (system: TeamSystemView, favorite: boolean) => void;
}

function knowledgeNames(system: TeamSystemView): (string | null)[] {
  return system.knowledge.map((member) => member.displayName);
}

const EXPOSURE_ICONS: Record<SystemType, typeof Building2> = {
  internt: Building2,
  eksternt: Globe,
  uavklart: CircleHelp,
};

/**
 * The internal/external classification as a small badge. The text is the meaning; the icon is decorative, so the value is
 * never conveyed by colour or icon alone.
 */
export function SystemExposureBadge({ systemType }: { systemType: SystemType }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-field border border-border-subtle bg-surface-subtle px-2 py-0.5 text-help font-medium text-text-primary">
      <Icon icon={EXPOSURE_ICONS[systemType]} size="inline" />
      {SYSTEM_TYPE_LABELS[systemType]}
    </span>
  );
}

/** Classification in compact form: the badge, then criticality and reach as secondary text. No extra table column. */
export function SystemClassificationLine({ classification }: { classification: SystemClassification }) {
  const copy = systemsCopy.classification;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-help text-text-muted">
      <SystemExposureBadge systemType={classification.systemType} />
      <span>
        {copy.compactCriticality}: {BUSINESS_CRITICALITY_LABELS[classification.businessCriticality]} · {copy.compactReach}:{" "}
        {USER_REACH_LABELS[classification.userReach]}
      </span>
    </span>
  );
}

/** Detail URL carrying the return state. The query is opaque to the detail page, which validates it again before use. */
function detailHref(teamId: string, systemId: string, returnQuery: string): string {
  const base = `/teams/${encodeURIComponent(teamId)}/systems/${encodeURIComponent(systemId)}`;
  return returnQuery.length > 0 ? `${base}?from=${encodeURIComponent(returnQuery)}` : base;
}

/**
 * Opens the system's detail page. A plain link, not a button in a clickable row: the row itself stays non-interactive, so
 * there is no nested interaction. The accessible name names the system.
 */
function DetailsLink({ teamId, system, returnQuery }: { teamId: string; system: TeamSystemView; returnQuery: string }) {
  return (
    <Link
      href={detailHref(teamId, system.systemId, returnQuery)}
      aria-label={`${systemsCopy.matrix.details}: ${system.name}`}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-control border border-border-subtle px-3 text-help font-medium text-text-secondary hover:border-border-strong hover:bg-surface-subtle hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:min-h-8"
    >
      <Icon icon={ChevronRight} size="inline" />
      {systemsCopy.matrix.details}
    </Link>
  );
}

/**
 * A personal favorite toggle. The star is decorative; the accessible name states the action ("Legg til favoritt: X" or
 * "Fjern favoritt: X"), and a filled star is the confirmed state. It is disabled while a write for this system is in flight
 * or while favorites are not ready, so a click can never be sent twice.
 */
function FavoriteButton({
  system,
  isFavorite,
  disabled,
  onToggle,
}: {
  system: TeamSystemView;
  isFavorite: boolean;
  disabled: boolean;
  onToggle: (system: TeamSystemView, favorite: boolean) => void;
}) {
  const label = isFavorite ? systemsCopy.favorites.remove(system.name) : systemsCopy.favorites.add(system.name);
  return (
    <button
      type="button"
      onClick={() => onToggle(system, !isFavorite)}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-surface-subtle hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 sm:size-8"
    >
      <Icon icon={Star} size="inline" className={isFavorite ? "fill-current text-primary" : undefined} />
    </button>
  );
}

/**
 * The system matrix (reference 16). From the `lg` breakpoint up: one row per system, one compact status icon per quality
 * attribute, knowledge risk and actions. Below it, system cards carry the same seven attributes in a compact grid so no
 * desktop table is squeezed onto a narrow screen. Each row and card has a favorite toggle and a detail link.
 */
export function SystemList({
  teamId,
  systems,
  returnQuery,
  favoriteIds,
  favoritesReady,
  pendingFavoriteIds,
  onToggleFavorite,
}: SystemListProps) {
  const favoriteControl = (system: TeamSystemView) => (
    <FavoriteButton
      system={system}
      isFavorite={favoriteIds.has(system.systemId)}
      disabled={!favoritesReady || pendingFavoriteIds.has(system.systemId)}
      onToggle={onToggleFavorite}
    />
  );
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
                  <span className="flex items-start gap-1">
                    {favoriteControl(system)}
                    <span className="flex min-w-0 flex-col gap-1 pt-1">
                      <span className="block text-label font-semibold text-text-primary">{system.name}</span>
                      <span className="block text-help text-text-muted">{system.description ?? systemsCopy.empty.noDescription}</span>
                      <SystemClassificationLine classification={system.classification} />
                    </span>
                  </span>
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
                    <DetailsLink teamId={teamId} system={system} returnQuery={returnQuery} />
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
            <div className="flex items-start gap-1">
              {favoriteControl(system)}
              <div className="flex min-w-0 flex-col gap-1 pt-1">
                <h3 className="text-label font-semibold text-text-primary">{system.name}</h3>
                <p className="text-help text-text-muted">{system.description ?? systemsCopy.empty.noDescription}</p>
                <SystemClassificationLine classification={system.classification} />
              </div>
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
              <DetailsLink teamId={teamId} system={system} returnQuery={returnQuery} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
