"use client";

import { useState, type ReactNode } from "react";
import { useAnnounceTeamName } from "../../../components/nav/TeamContext";
import { PageHeader } from "../../../components/ui/PageHeader";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamsOverview } from "../client/teams-overview-gateway";
import { teamsCopy } from "../copy";
import { TeamIdentity } from "./TeamIdentity";
import { TeamRouteNav } from "./TeamRouteNav";

/**
 * Shared header for every `/teams/[teamId]/...` page (docs/archive/features/team-experience-redesign
 * SPEC — BR-30): the team name as the page `<h1>`, optional header content (counts, summary), then the five-tab
 * navigation. A caller that already holds the name passes it and skips the overview read. Otherwise the name comes
 * from the caller's own teams-overview read; a failed or incomplete read falls back to the generic team label and
 * never blocks the page.
 */
export function TeamPageHeader({
  teamId,
  name: providedName,
  children,
}: {
  teamId: string;
  /** Team name already loaded by the caller; when present no overview read is made. */
  name?: string;
  /** Optional header content rendered under the title and above the tabs. */
  children?: ReactNode;
}) {
  const [fetchedName, setFetchedName] = useState<string | undefined>(undefined);

  useAuthGatedResource(
    (token, generation, isCurrentGeneration) => {
      if (providedName !== undefined) {
        return;
      }
      if (!token) {
        setFetchedName(undefined);
        return;
      }
      fetchTeamsOverview(token).then((overview) => {
        if (!isCurrentGeneration(generation)) {
          return;
        }
        const found = overview.status === "ok" ? overview.teams.find((team) => team.teamId === teamId) : undefined;
        setFetchedName(found?.name);
      });
    },
    [teamId, providedName],
  );

  const name = providedName ?? fetchedName;
  // The shell shows the team name as context on every team page, not only on the overview.
  useAnnounceTeamName(name ?? null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div aria-hidden="true" className="size-16 shrink-0 overflow-hidden rounded-surface sm:size-20">
          <TeamIdentity teamId={teamId} />
        </div>
        <PageHeader title={name || teamsCopy.detail.fallbackName} />
      </div>
      {children}
      <TeamRouteNav teamId={teamId} />
    </div>
  );
}
