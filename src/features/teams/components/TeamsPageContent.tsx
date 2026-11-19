"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { CountStrip } from "../../../components/ui/CountStrip";
import { EmptyState } from "../../../components/ui/EmptyState";
import { matchesSearchQuery, normalizeSearchText } from "../../../components/ui/search-match";
import { TextField } from "../../../components/ui/TextField";
import { teamsCopy } from "../copy";
import type { TeamOverviewEntry } from "../client/teams-overview-gateway";
import { TeamCard, type TeamCardRequestState } from "./TeamCard";

/**
 * The `/teams` page body: a compact count strip, a client-side name search over the list already loaded, and the
 * caller's teams grouped apart from other visible active teams. Every value derives from `teams` (the server's
 * overview); nothing here is fetched or authorized. Search state lives here, so it resets whenever the parent
 * unmounts this body on an auth change.
 */
export function TeamsPageContent({
  teams,
  requestStates,
  onRequestAccess,
}: {
  teams: TeamOverviewEntry[];
  requestStates: Record<string, TeamCardRequestState | undefined>;
  onRequestAccess: (teamId: string) => void;
}) {
  const [query, setQuery] = useState("");

  const memberTeams = teams.filter((team) => team.isMember);
  const otherTeams = teams.filter((team) => !team.isMember);
  const adminCount = teams.filter((team) => team.relationship === "teamadmin").length;

  const searching = normalizeSearchText(query) !== "";
  const visibleMine = memberTeams.filter((team) => matchesSearchQuery(query, [team.name]));
  const visibleOthers = otherTeams.filter((team) => matchesSearchQuery(query, [team.name]));
  const hasVisible = visibleMine.length + visibleOthers.length > 0;

  const renderCard = (team: TeamOverviewEntry) => (
    <TeamCard
      key={team.teamId}
      team={team}
      requestState={requestStates[team.teamId]}
      onRequestAccess={() => onRequestAccess(team.teamId)}
    />
  );

  const grid = (cards: TeamOverviewEntry[]) => (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{cards.map(renderCard)}</ul>
  );

  // With no other visible team, the page title already names the single group, so its grid needs no heading.
  const singleGroup = otherTeams.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <CountStrip
        items={[
          { label: teamsCopy.overview.summaryMine, value: memberTeams.length },
          { label: teamsCopy.overview.summaryTeamAdmin, value: adminCount },
        ]}
      />

      {teams.length > 1 && (
        <div className="flex flex-col gap-2 sm:max-w-sm">
          <TextField
            id="teams-page-search"
            type="search"
            label={teamsCopy.overview.search.label}
            value={query}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
          {searching && (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
                {teamsCopy.overview.search.reset}
              </Button>
            </div>
          )}
        </div>
      )}

      {!hasVisible ? (
        <EmptyState>{teamsCopy.overview.search.noResults}</EmptyState>
      ) : singleGroup ? (
        grid(visibleMine)
      ) : (
        <>
          {(visibleMine.length > 0 || !searching) && (
            <section aria-labelledby="teams-mine-heading" className="flex flex-col gap-3">
              <h2 id="teams-mine-heading" className="text-section-title font-semibold text-text-primary">
                {teamsCopy.overview.mineSectionTitle}
              </h2>
              {visibleMine.length > 0 ? (
                grid(visibleMine)
              ) : (
                <EmptyState>{teamsCopy.overview.notMemberOfAny}</EmptyState>
              )}
            </section>
          )}
          {visibleOthers.length > 0 && (
            <section aria-labelledby="teams-other-heading" className="flex flex-col gap-3">
              <h2 id="teams-other-heading" className="text-section-title font-semibold text-text-primary">
                {teamsCopy.overview.otherSectionTitle}
              </h2>
              {grid(visibleOthers)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
