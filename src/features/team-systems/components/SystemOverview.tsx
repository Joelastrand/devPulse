"use client";

import { ASSESSMENT_ATTRIBUTES, ASSESSMENT_ATTRIBUTE_LABELS } from "../domain/team-system";
import type { TeamSystemView } from "../server/list-team-systems";
import { systemsCopy } from "../copy";
import { AssessmentStatusIcon, AttentionBadge, BackstageLink, RiskBadge } from "./SystemStatusBadges";
import { DetailsLink, FavoriteButton } from "./SystemList";

/** The overview's inputs. Same meaning as in `SystemList`; the page passes the same sorted, filtered rows to both views. */
export interface SystemOverviewProps {
  teamId: string;
  systems: readonly TeamSystemView[];
  returnQuery: string;
  favoriteIds: ReadonlySet<string>;
  favoritesReady: boolean;
  pendingFavoriteIds: ReadonlySet<string>;
  onToggleFavorite: (system: TeamSystemView, favorite: boolean) => void;
}

/**
 * Compact overview of the systems: one row per system with the status fields that already exist: knowledge risk, the
 * follow-up need, and each quality attribute as its own labelled icon. No composite quality score is shown, because none
 * exists. Every icon carries its attribute name and value as text, so the row never relies on colour or icon shape alone.
 * The detailed table is one switch away and keeps every column.
 */
export function SystemOverview({
  teamId,
  systems,
  returnQuery,
  favoriteIds,
  favoritesReady,
  pendingFavoriteIds,
  onToggleFavorite,
}: SystemOverviewProps) {
  return (
    <ul aria-label={systemsCopy.overview.label} className="divide-y divide-border-subtle rounded-control border border-border-subtle">
      {systems.map((system) => {
        const assessedAny = ASSESSMENT_ATTRIBUTES.some((attribute) => system.assessments[attribute].value !== "ikke_vurdert");
        return (
          <li key={system.systemId} data-testid="system-overview-row" className="flex flex-col gap-3 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="flex min-w-0 flex-1 basis-56 items-start gap-1">
                <FavoriteButton
                  system={system}
                  isFavorite={favoriteIds.has(system.systemId)}
                  disabled={!favoritesReady || pendingFavoriteIds.has(system.systemId)}
                  onToggle={onToggleFavorite}
                />
                <div className="flex min-w-0 flex-col gap-0.5 pt-1">
                  <h3 className="break-words text-label font-semibold text-text-primary">{system.name}</h3>
                  <span className="break-words text-help text-text-muted">{system.description ?? systemsCopy.empty.noDescription}</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <BackstageLink url={system.backstageUrl} systemName={system.name} />
                <DetailsLink teamId={teamId} system={system} returnQuery={returnQuery} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-11">
              <RiskBadge band={system.knowledgeRisk} />
              <AttentionBadge attention={system.attention} assessedAny={assessedAny} />
            </div>
            <ul aria-label={systemsCopy.overview.qualityLabel} className="flex flex-wrap gap-x-3 gap-y-2 pl-11">
              {ASSESSMENT_ATTRIBUTES.map((attribute) => (
                <li key={attribute} className="flex items-center gap-1.5">
                  <AssessmentStatusIcon attributeLabel={ASSESSMENT_ATTRIBUTE_LABELS[attribute]} value={system.assessments[attribute].value} />
                  <span className="text-help text-text-secondary">{systemsCopy.matrix.headers[attribute]}</span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
