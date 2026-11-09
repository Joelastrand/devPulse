"use client";

import { TEAM_SETTINGS_COPY } from "../copy";
import { useCollaborativeTeamData } from "../client/use-collaborative-team-data";
import { ProfileModeControl } from "./ProfileModeControl";

/**
 * Teaminnstillinger: the competence-profile mode section (R-3). Loads the current mode and whether the viewer is a
 * teamadmin, then renders `ProfileModeControl`. Members see the mode read-only. Server-side authorization decides every
 * save; `canEdit` only shows the control.
 */
export function TeamSettingsCompetenceProfile({ teamId }: { readonly teamId: string }) {
  const { phase, token, current, reload } = useCollaborativeTeamData(teamId);

  return (
    <section aria-labelledby="team-settings-profile-heading" className="flex flex-col gap-4">
      <h2 id="team-settings-profile-heading" className="text-lg font-semibold text-text-primary">
        {TEAM_SETTINGS_COPY.profileHeading}
      </h2>
      <p className="text-sm text-text-secondary">{TEAM_SETTINGS_COPY.profileIntro}</p>

      {phase === "loading" || (token !== null && current === null) ? (
        <p className="text-sm text-text-secondary">{TEAM_SETTINGS_COPY.loading}</p>
      ) : null}
      {current !== null && current.profile.status === "ok" && current.areas.status === "ok" ? (
        <ProfileModeControl
          teamId={teamId}
          token={token ?? ""}
          mode={current.profile.mode}
          canEdit={current.areas.canEdit}
          onSaved={reload}
        />
      ) : null}
      {current !== null && (current.profile.status === "forbidden" || current.areas.status === "forbidden") ? (
        <p className="text-sm text-text-secondary">{TEAM_SETTINGS_COPY.forbidden}</p>
      ) : null}
      {current !== null &&
      (current.profile.status === "read_failed" ||
        current.profile.status === "team_disabled" ||
        current.areas.status === "read_failed" ||
        current.areas.status === "team_disabled") ? (
        <p className="text-sm text-text-secondary">{TEAM_SETTINGS_COPY.readFailed}</p>
      ) : null}
    </section>
  );
}
