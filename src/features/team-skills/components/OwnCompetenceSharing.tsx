"use client";

import { useEffect, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamsOverview } from "../../teams/client/teams-overview-gateway";
import type { TeamOverviewEntry } from "../../teams/client/teams-overview-gateway";
import { sharingExplanationCopy } from "../copy";
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

  useAuthGatedResource((token) => {
    setAuth(token ? { phase: "signed_in", token } : { phase: "signed_out" });
  }, []);

  const token = auth.phase === "signed_in" ? auth.token : null;
  const [explainingTeam, setExplainingTeam] = useState<string | null>(null);

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

  if (token === null || teams.phase === "loading") {
    return (
      <section aria-labelledby="own-sharing-heading" className="flex flex-col gap-2">
        <h2 id="own-sharing-heading" className="text-lg font-semibold text-text-primary">
          Del kompetanse med teamet
        </h2>
        <p className="text-text-secondary">Laster delingsvalgene dine…</p>
      </section>
    );
  }

  if (teams.phase === "error") {
    return (
      <section aria-labelledby="own-sharing-heading" className="flex flex-col gap-2">
        <h2 id="own-sharing-heading" className="text-lg font-semibold text-text-primary">
          Del kompetanse med teamet
        </h2>
        <Alert variant="error">Delingsvalgene dine kunne ikke lastes akkurat nå.</Alert>
      </section>
    );
  }

  const memberTeams = teams.teams.filter((team) => team.relationship === "member");

  return (
    <section aria-labelledby="own-sharing-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="own-sharing-heading" className="text-lg font-semibold text-text-primary">
          Del kompetanse med teamet
        </h2>
        <p className="text-sm text-text-secondary">
          Av som standard. Du velger selv per team om dine egne vurderinger skal inngå i teamets kompetanseoversikt. Du kan
          slutte når som helst.
        </p>
      </div>
      {memberTeams.length === 0 ? (
        <p className="text-text-secondary">Du er ikke medlem av et team, så det finnes ingen deling å styre.</p>
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
