"use client";

import { useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchOwnProfile } from "../client/profile-gateway";
import { profileCopy } from "../copy";

type NameState = { phase: "loading" } | { phase: "ok"; displayName: string | null } | { phase: "error" };

/**
 * The viewer's own display name in the profile header band (visual-redesign TASK-016, decision A). It reads the same
 * owner-only profile read as the form (`fetchOwnProfile`), with no new endpoint or field. "Min profil" stays the only h1.
 */
export function ProfileHeaderName() {
  const [state, setState] = useState<NameState>({ phase: "loading" });

  useAuthGatedResource((token, generation, isCurrentGeneration) => {
    if (token === null) {
      setState({ phase: "loading" });
      return;
    }
    setState({ phase: "loading" });
    void fetchOwnProfile(token).then((result) => {
      if (!isCurrentGeneration(generation)) return;
      setState(result.status === "ok" ? { phase: "ok", displayName: result.displayName } : { phase: "error" });
    });
  });

  if (state.phase === "loading") return null;
  if (state.phase === "error") return null;
  return (
    <p className="text-body text-text-primary">
      <span className="text-text-secondary">{profileCopy.fieldLabel}: </span>
      <span className="font-medium">{state.displayName ?? profileCopy.noName}</span>
    </p>
  );
}
