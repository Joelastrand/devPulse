"use client";

import { useEffect, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import Link from "next/link";
import { Button } from "../../../components/ui/Button";
import { LoadingRegion, Skeleton } from "../../../components/ui/Skeleton";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamsOverview } from "../../teams/client/teams-overview-gateway";
import type { TeamOverviewEntry } from "../../teams/client/teams-overview-gateway";
import { adminWithoutMembershipCopy, sharingExplanationCopy } from "../copy";
import { SharingExplanationDialog } from "./SharingExplanationDialog";
import { SkillContributionPanel } from "./SkillContributionPanel";

type AuthState = { phase: "loading" } | { phase: "signed_out" } | { phase: "signed_in"; token: string };
type TeamsState = { phase: "loading" } | { phase: "error" } | { phase: "loaded"; teams: TeamOverviewEntry[] };

/**
 * The owner's "Del kompetanse med teamet" control on `/me/skills` (TASK-009, SPEC BR-21–BR-23, SECURITY invariant 32).
 * One explicit control per team the caller is a member of. Each control is the existing C2 participation panel, so the
 * state is read from and written to the existing C2 team membership record through the owner-only endpoint. Sharing is OFF
 * until the owner opts in there. Non-members are not listed, and the panel hides itself for any team it cannot manage.
 */
export function OwnCompetenceSharing() {
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });
  const [teams, setTeams] = useState<TeamsState>({ phase: "loading" });

  const [explainingTeam, setExplainingTeam] = useState<string | null>(null);

  useAuthGatedResource((token) => {
    setAuth(token ? { phase: "signed_in", token } : { phase: "signed_out" });
    // Every auth change (sign-out, a direct switch to another account, or a token refresh) drops the team list that was read
    // under the previous token. The browser cannot tell a switch from a refresh, so the list is re-read for the current
    // token instead of keeping the previous account's teams on screen while the new read is pending.
    setTeams({ phase: "loading" });
    setExplainingTeam(null);
  }, []);

  const token = auth.phase === "signed_in" ? auth.token : null;
  useEffect(() => {
    if (token === null) return;
    let cancelled = false;
    void fetchTeamsOverview(token).then((result) => {
      if (cancelled) return;
      setTeams(result.status === "ok" ? { phase: "loaded", teams: result.teams } : { phase: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (auth.phase === "signed_out") {
    return (
      <section aria-labelledby="own-sharing-heading" className="flex flex-col gap-2">
        <h2 id="own-sharing-heading" className="text-lg font-semibold text-text-primary">
          Deling med team
        </h2>
        <p className="text-text-secondary">Logg inn for å se delingsvalgene dine.</p>
      </section>
    );
  }

  if (token === null || teams.phase === "loading") {
    return (
      <section aria-labelledby="own-sharing-heading" className="flex flex-col gap-4">
        <h2 id="own-sharing-heading" className="text-lg font-semibold text-text-primary">
          Deling med team
        </h2>
        {/* Reserves the team block (open-explanation button and the sharing control) so the list does not jump on load. */}
        <LoadingRegion label="Laster delingsvalgene dine…" className="flex flex-col gap-2">
          <div aria-hidden="true" className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-16 w-full" />
          </div>
        </LoadingRegion>
      </section>
    );
  }

  if (teams.phase === "error") {
    return (
      <section aria-labelledby="own-sharing-heading" className="flex flex-col gap-2">
        <h2 id="own-sharing-heading" className="text-lg font-semibold text-text-primary">
          Deling med team
        </h2>
        <Alert variant="error">Delingsvalgene dine kunne ikke lastes akkurat nå.</Alert>
      </section>
    );
  }

  // Gated on the genuine membership flag, not on `relationship`: an app admin's relationship is "admin" on every team,
  // which must never be read as participation (SECURITY invariants 32–33).
  const memberTeams = teams.teams.filter((team) => team.isMember);

  return (
    <section aria-labelledby="own-sharing-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="own-sharing-heading" className="text-lg font-semibold text-text-primary">
          Deling med team
        </h2>
        <p className="text-sm text-text-secondary">
          Deling er av som standard. Du velger selv per team, og du kan slutte når som helst. Status for hvert team vises under,
          sammen med vilkårene for deling.
        </p>
      </div>
      {memberTeams.length === 0 ? (
        teams.teams.some((team) => team.canOpen && !team.isMember) ? (
          <div className="flex flex-col gap-2 text-text-secondary">
            <p>{adminWithoutMembershipCopy.body}</p>
            <p>
              <Link href="/admin/teams" className="font-medium text-text-primary underline">
                {adminWithoutMembershipCopy.linkLabel}
              </Link>
            </p>
          </div>
        ) : (
          <p className="text-text-secondary">Du er ikke medlem av et team, så det finnes ingen deling å styre.</p>
        )
      ) : (
        memberTeams.map((team) => (
          <div key={team.teamId} className="flex flex-col gap-2">
            <div>
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                aria-haspopup="dialog"
                aria-label={`${sharingExplanationCopy.open} i «${team.name}»`}
                onClick={() => setExplainingTeam(team.teamId)}
              >
                {sharingExplanationCopy.open}
              </Button>
            </div>
            <SkillContributionPanel teamId={team.teamId} token={token} teamName={team.name} wording="sharing" />
          </div>
        ))
      )}
      {explainingTeam !== null && (
        <SharingExplanationDialog
          teamName={memberTeams.find((team) => team.teamId === explainingTeam)?.name ?? ""}
          onClose={() => setExplainingTeam(null)}
        />
      )}
    </section>
  );
}
