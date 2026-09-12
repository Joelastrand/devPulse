"use client";

import { useRouter } from "next/navigation";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamsOverview } from "../../teams/client/teams-overview-gateway";
import { resultsCopy } from "../copy";

/**
 * `/results` compatibility redirect (docs/features/team-management/SPEC.md
 * — BR-33, BR-34; TASK-011). There is no server-side session to redirect
 * from (SPEC → Architecture decisions → "No server-side session"), so this
 * resolves auth state client-side and reuses the existing, unchanged
 * TASK-007 "my teams" overview — no new server logic. Exactly one
 * `"member"` relationship (the SPEC's precise "team membership" vocabulary,
 * distinct from `"admin"` — see Key Concepts) redirects to that team's
 * `/teams/[teamId]`; every other state (signed out, zero or more than one
 * membership, an app admin with no plain membership, or a read failure)
 * redirects to the general `/teams` overview.
 *
 * Uses the shared `useAuthGatedResource` generation guard: a slow overview
 * response for a superseded identity (e.g. a fast account switch right
 * after page load) can never fire a redirect meant for the previous
 * account.
 */
export function ResultsRedirect() {
  const router = useRouter();

  useAuthGatedResource((token, generation, isCurrentGeneration) => {
    if (!token) {
      router.replace("/teams");
      return;
    }

    fetchTeamsOverview(token).then((result) => {
      if (!isCurrentGeneration(generation)) {
        return;
      }

      if (result.status === "ok") {
        const memberships = result.teams.filter((team) => team.relationship === "member");
        if (memberships.length === 1) {
          router.replace(`/teams/${encodeURIComponent(memberships[0].teamId)}`);
          return;
        }
      }

      router.replace("/teams");
    });
  });

  return <LoadingState label={resultsCopy.redirect.redirecting} />;
}
