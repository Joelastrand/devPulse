"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamSkillLevels, type FetchTeamSkillLevelsResult } from "../../team-skills/client/team-skills-gateway";
import { TEAM_PROFILE_STATE_COPY } from "../copy";
import type { AutomaticSkillLevelRow } from "../domain/automatic-profile";
import { AutomaticCompetenceProfile } from "./AutomaticCompetenceProfile";

type AuthState = { phase: "loading" } | { phase: "signed_out" } | { phase: "signed_in"; token: string };
/** A result is tagged with the request it answers, so a response for an earlier team, token or attempt is never shown. */
type ProfileState = { requestKey: string; result: FetchTeamSkillLevelsResult } | null;

/**
 * Loads the automatic numeric profile (owner-approved k = 3) for one team. `token: null` means no request is made. The
 * result is `null` while loading. The hook holds no member data and computes nothing: every value comes from the server.
 */
export function useAutomaticTeamProfile(teamId: string, token: string | null): { current: FetchTeamSkillLevelsResult | null; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [profile, setProfile] = useState<ProfileState>(null);
  const requestKey = token === null ? null : `${teamId}|${token}|${attempt}`;

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
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { current, retry };
}

/** The numeric rows, only when the server says the whole profile is available. Anything else is not a profile. */
export function availableAutomaticRows(current: FetchTeamSkillLevelsResult | null): readonly AutomaticSkillLevelRow[] | null {
  return current !== null && current.status === "ok" && current.availability === "available" ? current.rows : null;
}

/** The radar, or the honest state message for the result that replaces it. */
export function AutomaticProfileView({
  current,
  signedOut,
  onRetry,
}: {
  readonly current: FetchTeamSkillLevelsResult | null;
  readonly signedOut: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      {signedOut ? <p className="text-sm text-text-secondary">{TEAM_PROFILE_STATE_COPY.signedOut}</p> : null}
      {!signedOut && current === null ? <p className="text-sm text-text-secondary">{TEAM_PROFILE_STATE_COPY.loading}</p> : null}
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
            onClick={onRetry}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-text-primary"
          >
            {TEAM_PROFILE_STATE_COPY.retry}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Teamkompetanse radar panel for automatic mode, standalone. The team overview uses `useAutomaticTeamProfile` directly so
 * that its figures and this radar share one request.
 */
export function TeamCompetenceProfile({ teamId }: { readonly teamId: string }) {
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });

  useAuthGatedResource((token) => {
    setAuth(token ? { phase: "signed_in", token } : { phase: "signed_out" });
  }, []);

  const token = auth.phase === "signed_in" ? auth.token : null;
  const { current, retry } = useAutomaticTeamProfile(teamId, token);
  return <AutomaticProfileView current={current} signedOut={auth.phase === "signed_out"} onRetry={retry} />;
}
