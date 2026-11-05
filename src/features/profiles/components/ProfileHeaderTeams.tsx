"use client";

import { useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamsOverview, type TeamOverviewEntry } from "../../teams/client/teams-overview-gateway";
import { profileCopy } from "../copy";

type TeamsState = { phase: "loading" } | { phase: "ok"; teams: TeamOverviewEntry[] } | { phase: "error" };

/**
 * Team membership in the profile header band (visual-fidelity TASK-018, reference 13). It reads the existing `/teams`
 * overview through `fetchTeamsOverview` and shows only teams the viewer belongs to or administers. Pending requests and
 * invitations are not membership and are not shown here. No new endpoint or field.
 */
export function ProfileHeaderTeams() {
  const [state, setState] = useState<TeamsState>({ phase: "loading" });

  useAuthGatedResource((token, generation, isCurrentGeneration) => {
    if (token === null) {
      setState({ phase: "loading" });
      return;
    }
    setState({ phase: "loading" });
    void fetchTeamsOverview(token).then((result) => {
      if (!isCurrentGeneration(generation)) return;
      setState(result.status === "ok" ? { phase: "ok", teams: result.teams } : { phase: "error" });
    });
  });

  if (state.phase !== "ok") return null;
  const memberships = state.teams.filter((team) => team.relationship === "member" || team.relationship === "admin");
  // No new copy for an empty membership: the band simply shows no team line.
  if (memberships.length === 0) return null;
  return (
    <p className="text-body text-text-primary">
      <span className="text-text-secondary">{profileCopy.teamsTitle}: </span>
      <span className="font-medium">{memberships.map((team) => team.name).join(", ")}</span>
    </p>
  );
}
