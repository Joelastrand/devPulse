"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  fetchCollaborativeProfile,
  fetchTeamAreas,
  type CollaborativeProfileResult,
  type TeamAreasResult,
} from "./collaborative-gateway";

type AuthState = { phase: "loading" } | { phase: "signed_out" } | { phase: "signed_in"; token: string };

export interface CollaborativeTeamData {
  /** Identifies one loaded snapshot. Components that hold local form state are keyed by it, so a reload resets them. */
  readonly key: string;
  readonly profile: CollaborativeProfileResult;
  readonly areas: TeamAreasResult;
}

/**
 * Loads the team's profile mode, levels and areas for the signed-in user. A result is tagged with the request it answers,
 * so a response for an earlier team, token or reload is never shown. `reload` refetches after a successful write.
 */
export function useCollaborativeTeamData(teamId: string) {
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });
  const [generation, setGeneration] = useState(0);
  const [loaded, setLoaded] = useState<CollaborativeTeamData | null>(null);

  useAuthGatedResource((token) => {
    setGeneration((n) => n + 1);
    setAuth(token ? { phase: "signed_in", token } : { phase: "signed_out" });
  }, []);

  const token = auth.phase === "signed_in" ? auth.token : null;
  const requestKey = token === null ? null : `${teamId}|${generation}`;

  useEffect(() => {
    if (token === null || requestKey === null) return;
    let cancelled = false;
    void Promise.all([fetchCollaborativeProfile(token, teamId), fetchTeamAreas(token, teamId)]).then(([profile, areas]) => {
      if (!cancelled) setLoaded({ key: requestKey, profile, areas });
    });
    return () => {
      cancelled = true;
    };
  }, [token, teamId, requestKey]);

  const reload = useCallback(() => setGeneration((n) => n + 1), []);
  const current = loaded !== null && loaded.key === requestKey ? loaded : null;

  return { phase: auth.phase, token, current, reload };
}
