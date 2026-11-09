"use client";

import { useEffect, useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamSkillLevels, type FetchTeamSkillLevelsResult } from "../../team-skills/client/team-skills-gateway";
import { TEAM_PROFILE_STATE_COPY } from "../copy";
import { AutomaticCompetenceProfile } from "./AutomaticCompetenceProfile";

type AuthState = { phase: "loading" } | { phase: "signed_out" } | { phase: "signed_in"; token: string };
/** A result is tagged with the request it answers, so a response for an earlier team, token or attempt is never shown. */
type ProfileState = { requestKey: string; result: FetchTeamSkillLevelsResult } | null;

/**
 * Teamkompetanse radar panel (owner-approved automatic numeric profile, k = 3). Loads the strict DTO from the server and
 * renders it through the existing `AutomaticCompetenceProfile`. It holds no member data and computes nothing: every value
 * comes from the server, and each refusal or incomplete state is shown as its own honest message.
 */
export function TeamCompetenceProfile({ teamId }: { readonly teamId: string }) {
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });
  const [generation, setGeneration] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [profile, setProfile] = useState<ProfileState>(null);

  useAuthGatedResource((token) => {
    setGeneration((n) => n + 1);
    setAuth(token ? { phase: "signed_in", token } : { phase: "signed_out" });
  }, []);

  const token = auth.phase === "signed_in" ? auth.token : null;
  const requestKey = token === null ? null : `${teamId}|${generation}|${attempt}`;

  useEffect(() => {
    if (token === null || requestKey === null) return;
    let cancelled = false;
    void fetchTeamSkillLevels(token, teamId).then((result) => {
      if (!cancelled) setProfile({ requestKey, result });
    });
    return () => {
      cancelled = true;
    };
  }, [token, teamId, requestKey]);

  const current = profile !== null && profile.requestKey === requestKey ? profile.result : null;

  return (
    <section className="flex flex-col gap-4">
      {auth.phase === "signed_out" ? <p className="text-sm text-text-secondary">{TEAM_PROFILE_STATE_COPY.signedOut}</p> : null}
      {auth.phase === "loading" || (token !== null && current === null) ? (
        <p className="text-sm text-text-secondary">{TEAM_PROFILE_STATE_COPY.loading}</p>
      ) : null}
      {current !== null && current.status === "ok" && current.availability === "incomplete" ? (
        <p className="text-sm text-text-secondary">{TEAM_PROFILE_STATE_COPY.incomplete}</p>
      ) : null}
      {current !== null && current.status === "ok" && current.availability === "available" ? (
        <AutomaticCompetenceProfile rows={current.rows} />
      ) : null}
      {current !== null && current.status === "forbidden" ? <p className="text-sm text-text-secondary">{TEAM_PROFILE_STATE_COPY.forbidden}</p> : null}
      {current !== null && current.status === "team_disabled" ? (
        <p className="text-sm text-text-secondary">{TEAM_PROFILE_STATE_COPY.teamDisabled}</p>
      ) : null}
      {current !== null && (current.status === "read_failed" || current.status === "unauthenticated") ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-text-secondary">{TEAM_PROFILE_STATE_COPY.readFailed}</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-text-primary"
          >
            {TEAM_PROFILE_STATE_COPY.retry}
          </button>
        </div>
      ) : null}
    </section>
  );
}
