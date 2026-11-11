"use client";

import { useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchOwnFormalRole, type OwnFormalRole } from "../client/formal-role-gateway";
import { workspaceCopy } from "../copy";

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "error" }
  | { phase: "ready"; role: OwnFormalRole };

/**
 * "Min rolle" (`/me/skills?vy=rolle`): the organizational role an administrator assigned to the signed-in person. Shows the
 * title and description, or a concise empty state. The role grants no permission and is shown to nobody else.
 */
export function FormalRoleSection() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });

  useAuthGatedResource((token, generation, isCurrentGeneration) => {
    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }
    setState({ phase: "loading" });
    void fetchOwnFormalRole(token).then((result) => {
      if (!isCurrentGeneration(generation)) return;
      if (result.status === "ok") setState({ phase: "ready", role: result.role });
      else if (result.status === "unauthenticated") setState({ phase: "signed_out" });
      else setState({ phase: "error" });
    });
  });

  return (
    <section aria-labelledby="formal-role-heading" className="space-y-2 rounded-lg border border-border-subtle bg-surface p-4">
      <h2 id="formal-role-heading" className="text-base font-semibold text-text-primary">
        {workspaceCopy.formalRole.heading}
      </h2>
      <FormalRoleBody state={state} />
    </section>
  );
}

function FormalRoleBody({ state }: { state: ViewState }) {
  if (state.phase === "loading") {
    return <p className="text-sm text-text-secondary">{workspaceCopy.formalRole.loading}</p>;
  }
  if (state.phase === "signed_out") {
    return <p className="text-sm text-text-secondary">{workspaceCopy.formalRole.signedOut}</p>;
  }
  if (state.phase === "error") {
    return <p className="text-sm text-text-secondary">{workspaceCopy.formalRole.readFailed}</p>;
  }
  if (state.role.status === "none") {
    return (
      <>
        <p className="text-sm text-text-primary">{workspaceCopy.formalRole.none}</p>
        <p className="text-sm text-text-secondary">{workspaceCopy.formalRole.explanation}</p>
      </>
    );
  }
  return (
    <>
      <h3 className="text-sm font-semibold text-text-primary">{state.role.title}</h3>
      <p className="whitespace-pre-line text-sm text-text-secondary">{state.role.description}</p>
    </>
  );
}
