"use client";

import { useState } from "react";
import { PageHeader } from "../../../components/ui/PageHeader";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamsOverview } from "../client/teams-overview-gateway";
import { teamsCopy } from "../copy";
import { TeamRouteNav } from "./TeamRouteNav";

/**
 * Shared header for every `/teams/[teamId]/...` page (docs/features/team-experience-redesign
 * SPEC — BR-30): the team name as the page `<h1>`, then the five-tab navigation.
 * The name comes from the caller's own teams-overview read. A failed or
 * incomplete read falls back to the generic team label and never blocks the page.
 * Member, system and area counts are not shown here (no data source in this read).
 */
export function TeamPageHeader({ teamId }: { teamId: string }) {
  const [name, setName] = useState<string | undefined>(undefined);

  useAuthGatedResource(
    (token, generation, isCurrentGeneration) => {
      if (!token) {
        setName(undefined);
        return;
      }
      fetchTeamsOverview(token).then((overview) => {
        if (!isCurrentGeneration(generation)) {
          return;
        }
        const found = overview.status === "ok" ? overview.teams.find((team) => team.teamId === teamId) : undefined;
        setName(found?.name);
      });
    },
    [teamId],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={name || teamsCopy.detail.fallbackName} />
      <TeamRouteNav teamId={teamId} />
    </div>
  );
}
