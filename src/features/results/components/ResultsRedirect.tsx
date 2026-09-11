"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { observeIdToken } from "../../auth/client/auth-client";
import { fetchTeamsOverview } from "../../teams/client/teams-overview-gateway";

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
 * `generationRef` mirrors this feature's established stale-result guard
 * (`TeamsOverview`/`TeamDetail`/`AdminTeamDetail`): a slow overview response
 * for a superseded identity (e.g. a fast account switch right after page
 * load) can never fire a redirect meant for the previous account.
 */
export function ResultsRedirect() {
  const router = useRouter();
  const generationRef = useRef(0);

  useEffect(() => {
    const unsubscribe = observeIdToken((token) => {
      generationRef.current += 1;
      const generation = generationRef.current;

      if (!token) {
        router.replace("/teams");
        return;
      }

      fetchTeamsOverview(token).then((result) => {
        if (generationRef.current !== generation) {
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

    return () => {
      generationRef.current += 1;
      unsubscribe();
    };
  }, [router]);

  return (
    <p role="status" className="text-zinc-600 dark:text-zinc-400">
      Redirecting…
    </p>
  );
}
