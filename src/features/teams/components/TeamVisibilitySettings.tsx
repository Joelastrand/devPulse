"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { LoadingState } from "../../../components/ui/LoadingState";
import {
  fetchTeamVisibility,
  saveTeamVisibility,
  type TeamVisibilityValue,
} from "../client/team-visibility-gateway";
import { visibilityCopy } from "../visibility-copy";

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; visibility: TeamVisibilityValue; canAdminister: boolean };

type Feedback = { variant: "success" | "error"; message: string } | null;

const HEADING_ID = "team-visibility-heading";

/**
 * Team visibility panel. Visible to members and superadmins (the server decides who may read it). Only callers the server
 * reports as `canAdminister` see the change controls; the write is authorized again on the server. Making a team public
 * asks for confirmation first.
 */
export function TeamVisibilitySettings({ teamId, token }: { teamId: string; token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);

  // The parent re-keys this component on auth generation, so the token is stable for its lifetime.
  useEffect(() => {
    mountedRef.current = true;
    void fetchTeamVisibility(token, teamId).then((result) => {
      if (!mountedRef.current) return;
      if (result.status === "ok") {
        setPhase({ kind: "ready", visibility: result.visibility, canAdminister: result.canAdminister });
      } else {
        setPhase({ kind: "error", message: result.status === "forbidden" ? visibilityCopy.errorForbidden : visibilityCopy.errorRead });
      }
    });
    return () => {
      mountedRef.current = false;
    };
  }, [teamId, token]);

  async function change(next: TeamVisibilityValue) {
    setSaving(true);
    setFeedback(null);
    const result = await saveTeamVisibility(token, teamId, next);
    if (!mountedRef.current) return;
    setSaving(false);
    setConfirming(false);

    if (result.status !== "ok") {
      const message =
        result.status === "team_disabled"
          ? visibilityCopy.errorTeamDisabled
          : result.status === "erasure_in_progress"
            ? visibilityCopy.errorErasure
            : result.status === "forbidden" || result.status === "unauthenticated" || result.status === "not_found"
              ? visibilityCopy.errorForbidden
              : visibilityCopy.errorSave;
      setFeedback({ variant: "error", message });
      return;
    }

    setPhase((current) =>
      current.kind === "ready" ? { ...current, visibility: result.visibility } : current,
    );
    const message = !result.changed
      ? visibilityCopy.unchanged
      : result.visibility === "public"
        ? visibilityCopy.savedPublic
        : visibilityCopy.savedPrivate;
    setFeedback({ variant: "success", message });
  }

  return (
    <Card as="section" aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <h3 id={HEADING_ID} className="text-lg font-medium text-text-primary">
        {visibilityCopy.title}
      </h3>

      {phase.kind === "loading" && <LoadingState label={visibilityCopy.loading} />}
      {phase.kind === "error" && <Alert variant="error">{phase.message}</Alert>}

      {phase.kind === "ready" && (
        <>
          <p className="text-sm text-text-secondary" data-testid="team-visibility-status">
            {phase.visibility === "public" ? visibilityCopy.statusPublic : visibilityCopy.statusPrivate}
          </p>

          {phase.visibility === "private" && phase.canAdminister && !confirming && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-text-secondary">{visibilityCopy.explanationPublic}</p>
              <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setConfirming(true)}>
                {visibilityCopy.makePublicButton}
              </Button>
            </div>
          )}

          {phase.visibility === "private" && phase.canAdminister && confirming && (
            <div role="group" aria-label={visibilityCopy.confirmPublicTitle} className="flex flex-col gap-2">
              <p className="text-sm font-medium text-text-primary">{visibilityCopy.confirmPublicTitle}</p>
              <p className="text-sm text-text-secondary">{visibilityCopy.confirmPublicBody}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="primary" size="sm" disabled={saving} onClick={() => void change("public")}>
                  {saving ? visibilityCopy.savingLabel : visibilityCopy.confirmPublicButton}
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => setConfirming(false)}>
                  {visibilityCopy.cancelButton}
                </Button>
              </div>
            </div>
          )}

          {phase.visibility === "public" && phase.canAdminister && (
            <Button type="button" variant="secondary" size="sm" className="self-start" disabled={saving} onClick={() => void change("private")}>
              {saving ? visibilityCopy.savingLabel : visibilityCopy.makePrivateButton}
            </Button>
          )}

          {!phase.canAdminister && <p className="text-sm text-text-secondary">{visibilityCopy.readOnlyNote}</p>}

          {feedback && (
            <Alert variant={feedback.variant === "success" ? "success" : "error"}>{feedback.message}</Alert>
          )}
        </>
      )}
    </Card>
  );
}
