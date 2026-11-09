"use client";

import { useState } from "react";
import { PROFILE_MODES, DEFAULT_PROFILE_MODE, type ProfileMode } from "../domain/collaborative-profile";
import { PROFILE_MODE_COPY, TEAM_SETTINGS_COPY } from "../copy";
import { saveCollaborativeMode, type CollaborativeWriteStatus } from "../client/collaborative-gateway";

interface ProfileModeControlProps {
  readonly teamId: string;
  readonly token: string;
  readonly mode: ProfileMode;
  readonly canEdit: boolean;
  /** Called after a successful save so the caller can reload the team's profile. */
  readonly onSaved: () => void;
}

const SAVE_FAILURE_COPY: Partial<Record<CollaborativeWriteStatus, string>> = {
  forbidden: "Bare teamadmin kan endre modus.",
  team_disabled: "Teamet er ikke aktivt, så modus kan ikke endres.",
};

/**
 * Teamadmin control for the team's profile mode (R-3). Members see the current mode read-only. The mode is saved only on
 * an explicit button press, and a refused save keeps the previous mode visible. Switching modes does not touch stored
 * collaborative levels or any member's sharing choice.
 */
export function ProfileModeControl({ teamId, token, mode, canEdit, onSaved }: ProfileModeControlProps) {
  const [selected, setSelected] = useState<ProfileMode>(mode);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | CollaborativeWriteStatus>("idle");

  async function handleSave() {
    setStatus("saving");
    const result = await saveCollaborativeMode(token, teamId, selected);
    if (result.status === "ok") {
      setStatus("saved");
      onSaved();
      return;
    }
    setStatus(result.status);
  }

  const dirty = selected !== mode;
  const failureMessage = status !== "idle" && status !== "saving" && status !== "saved" ? SAVE_FAILURE_COPY[status] ?? TEAM_SETTINGS_COPY.saveFailed : null;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">{TEAM_SETTINGS_COPY.profileHeading}</legend>
        {PROFILE_MODES.map((option) => {
          const copy = PROFILE_MODE_COPY[option];
          const inputId = `profile-mode-${option}`;
          return (
            <div key={option} className="flex flex-col gap-1 rounded-md border border-border-subtle p-3">
              <label htmlFor={inputId} className="flex items-center gap-2 font-medium text-text-primary">
                <input
                  id={inputId}
                  type="radio"
                  name="competence-profile-mode"
                  value={option}
                  checked={selected === option}
                  disabled={!canEdit || status === "saving"}
                  onChange={() => {
                    setSelected(option);
                    setStatus("idle");
                  }}
                />
                <span>{copy.label}</span>
                {option === DEFAULT_PROFILE_MODE ? (
                  <span className="text-xs font-normal text-text-muted">({TEAM_SETTINGS_COPY.defaultBadge})</span>
                ) : null}
              </label>
              <p className="text-sm text-text-secondary">{copy.description}</p>
            </div>
          );
        })}
      </fieldset>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || status === "saving"}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-text-on-accent disabled:opacity-50"
          >
            {TEAM_SETTINGS_COPY.modeSave}
          </button>
          {status === "saved" && !dirty ? (
            <p role="status" className="text-sm text-text-secondary">
              {TEAM_SETTINGS_COPY.modeSaved}
            </p>
          ) : null}
          {failureMessage !== null ? (
            <p role="alert" className="text-sm text-text-primary">
              {failureMessage}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-text-secondary">{TEAM_SETTINGS_COPY.modeReadOnly}</p>
      )}

      <p className="text-sm text-text-secondary">{TEAM_SETTINGS_COPY.modeDoesNotChangeSharing}</p>
    </div>
  );
}
